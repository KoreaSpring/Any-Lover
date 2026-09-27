from ezvtb_rt.trt_utils import *
import pycuda.driver as cuda
from collections import OrderedDict
from typing import List, Optional
from ezvtb_rt.trt_engine import HostDeviceMem

#memory management
class VRAMMem(object):
    def __init__(self, nbytes:int):
        self.nbytes: int = nbytes
        self.device: cuda.DeviceAllocation = cuda.mem_alloc(nbytes)

    def __str__(self):
        return "Size:\n" + str(self.nbytes) + "\nDevice:\n" + str(self.device)

    def __repr__(self):
        return self.__str__()
    def __del__(self):
        self.device.free()


class VRAMCacher:
    """LRU cache for compressed VRAM buffers with configurable memory limit.
    
    Stores VRAMMem data in compressed form using VRAMCodeC to reduce VRAM usage.
    """
    
    def __init__(self, max_size_gb: float, stream: cuda.Stream = None):
        """
        Initialize the VRAM cacher.
        
        Args:
            max_size_gb: Maximum cache size in gigabytes.
            stream: Optional CUDA stream for operations.
        """
        self.max_size_bytes = int(max_size_gb * 1024 * 1024 * 1024)
        self.current_size_bytes = 0
        stream = stream if stream is not None else cuda.Stream()
        self.stream = stream
        self._cache: OrderedDict[int, List[VRAMMem]] = OrderedDict()
        self.hits = 0
        self.miss = 0
    
    @staticmethod
    def _calculate_entry_size(buffers: List[VRAMMem]) -> int:
        """Calculate total size of a cache entry in bytes."""
        return sum(buf.nbytes for buf in buffers)
    
    def _evict_until_fit(self, required_bytes: int) -> None:
        """Evict LRU entries until there's enough space for required_bytes."""
        while self._cache and (self.current_size_bytes + required_bytes > self.max_size_bytes):
            oldest_key, oldest_buffers = self._cache.popitem(last=False)
            evicted_size = self._calculate_entry_size(oldest_buffers)
            self.current_size_bytes -= evicted_size
    
    def put(self, key: int, buffers: List[HostDeviceMem]) -> None:
        """
        Store a list of HostDeviceMem buffers in the cache (compressed).
        
        Args:
            key: Integer key for the cache entry.
            buffers: List of HostDeviceMem objects to compress and cache.
        """
        if key in self._cache:
            self._cache.move_to_end(key)
            return  # Already cached
        saved_mems = []
        for buf in buffers:
            saved_mem = VRAMMem(buf.host.nbytes)
            cuda.memcpy_dtod_async(saved_mem.device, buf.device, buf.host.nbytes, self.stream)
            saved_mems.append(saved_mem)

        entry_size = self._calculate_entry_size(saved_mems)
        
        # Evict entries if needed to make room
        self._evict_until_fit(entry_size)
        
        # Add new entry at the end (most recently used)
        self._cache[key] = saved_mems
        self.current_size_bytes += entry_size
    
    def get(self, key: int) -> Optional[List[VRAMMem]]:
        """
        Retrieve and decode a cached entry by key.
        
        Args:
            key: Integer key to look up.
            
        Returns:
            List of decoded NVCompDeviceBuffer if found, None otherwise.
            Use the .device pointer to access decompressed data on GPU.
        """
        if key not in self._cache:
            self.miss += 1
            return None
        
        self.hits += 1
        # Move to end (most recently used)
        self._cache.move_to_end(key)
        
        # Decode all buffers
        return self._cache[key]
    
    def __contains__(self, key: int) -> bool:
        """Check if a key exists in the cache."""
        return key in self._cache
    
    def __len__(self) -> int:
        """Return the number of entries in the cache."""
        return len(self._cache)
    
    def clear(self) -> None:
        """Clear all entries from the cache."""
        self._cache.clear()
        self.current_size_bytes = 0
        self.hits = 0
        self.miss = 0
    
    @property
    def size_gb(self) -> float:
        """Return current cache size in gigabytes."""
        return self.current_size_bytes / (1024 * 1024 * 1024)
    
    @property
    def hit_rate(self) -> float:
        """Return cache hit rate as a fraction."""
        total = self.hits + self.miss
        return self.hits / total if total > 0 else 0.0
