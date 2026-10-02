import numpy as np
from collections import OrderedDict
import brotli
from typing import Optional

"""
Cache system with compression and LRU eviction.
Handles image data with synchronous compression/decompression.
Uses HuffYUV for efficient compression/decompression.
"""


class Cacher:
    """Main cache interface with synchronous compression.
    
    Attributes:
        cache: OrderedDict storing compressed entries
        encoder: HuffYUV encoder for compression
        decoder: HuffYUV decoder for decompression
        max_kbytes: Maximum cache size in kilobytes
        cached_kbytes: Current cache size in kilobytes
        hits: Total cache hits
        miss: Total cache misses
        continues_hits: Counter for sequential hits (anti-thrashing)
        last_hs: Last accessed hash key
    """
    
    def __init__(self, max_volume_giga:float = 2.0, width:int = 512, height:int = 512):
        """Initialize cache with specified size.
        
        Args:
            max_volume_giga: Maximum cache size in gigabytes (default 2.0)
        """
        self.cache = OrderedDict()  # LRU cache storage
        self.width = width
        self.height = height
        
        # Cache size management
        self.max_kbytes = max_volume_giga * 1024 * 1024  # Convert GB to KB
        self.cached_kbytes = 0  # Tracks total cached data size

        # Performance tracking
        self.hits = 0  # Total successful cache retrievals
        self.miss = 0  # Total cache misses

    def query(self, hs:int) -> bool:
        """Check if a hash key exists in the cache.
        
        Args:
            hs: Hash key to query
        Returns:
            bool: True if key exists, False otherwise
        """
        is_in = hs in self.cache
        if is_in:
            self.cache.move_to_end(hs)  # Update LRU position
        return is_in
    
    def get(self, hs:int) -> Optional[np.ndarray]:
        """Retrieve cached data by hash key without anti-thrashing.
        
        Args:
            hs: Hash key of requested data
        Returns:
            np.ndarray: Decompressed image data or None if miss
        """
        cached = self.cache.get(hs)
        if cached is not None:
            self.hits += 1
            self.cache.move_to_end(hs)
            result_img = np.frombuffer(brotli.decompress(cached), dtype=np.uint8).reshape((self.height, self.width, 4))
            return result_img
        else:
            self.miss += 1
            return None

    def put(self, hs:int, data:np.ndarray):
        """Write data to cache with compression.
        
        Args:
            hs: Hash key for the data
            data: Raw image data to cache
        """
        # Skip if already cached
        if hs in self.cache:
            return
            
        # Compress data
        compressed = brotli.compress(data.data, quality=0)
        
        # Add to cache and update size tracking
        self.cache[hs] = compressed
        self.cached_kbytes += len(compressed) / 1024  # Track size in KB
        
        # LRU eviction when over capacity
        while self.cached_kbytes > self.max_kbytes:
            poped = self.cache.popitem(last=False)  # Remove oldest entry
            self.cached_kbytes -= len(poped[1]) / 1024
            poped = None  # Allow GC
