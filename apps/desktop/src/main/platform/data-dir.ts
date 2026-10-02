// 大体积资源的落盘根目录（后端运行时副本、THA 运行时与高画质模型）。
//
// 规则：
//   - 用户在启动页「安装位置」选了目录（settings.ollamaDir，且不是默认的 userData/ollama）且可写
//     → 大资源放到该目录下（<dir>/runtime、<dir>/tha-runtime），和 Ollama 及其模型放在一起；
//   - 否则 → 保持原位置 userData（%APPDATA%\Any-Lover）。
// 设置、日志、聊天记录、记忆等小文件始终留在 userData，不受影响。

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { readSettings } from './settings-store';
import { defaultInstallDir } from '../sidecar/ollama-installer';

type Log = (msg: string) => void;

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/** 同一盘符（rename 可瞬间完成）。 */
export function sameVolume(a: string, b: string): boolean {
  return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase();
}

/** 目录可写探测（不存在则尝试创建）。Program Files 等受保护目录会返回 false。 */
export function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析用户选择的资源根目录；未选择 / 选的就是默认位置 / 不可写 时返回 null。
 * 纯函数（依赖注入），便于单测。
 */
export function resolveChosenRoot(
  chosen: string | undefined,
  userData: string,
  writable: (dir: string) => boolean = isWritableDir,
): string | null {
  const dir = String(chosen || '').trim();
  if (!dir) return null;
  if (samePath(dir, defaultInstallDir(userData))) return null;
  if (!writable(dir)) return null;
  return path.resolve(dir);
}

/** 当前大资源根目录：用户选择的安装位置，或 userData。 */
export function largeDataRoot(): string {
  const userData = app.getPath('userData');
  return resolveChosenRoot(readSettings().ollamaDir, userData) || userData;
}

export interface LargeDirOptions {
  /**
   * 跨盘时旧副本里是否有「重新获取代价大」的内容（如已下载的高画质模型）。
   * 返回 true → 继续用旧位置；false（默认）→ 在新位置重新铺设，旧副本由 cleanupLegacy 删除。
   */
  keepOldIf?: (oldDir: string) => boolean;
}

/** 跨盘放弃、等待调用方铺设完成后删除的旧副本。 */
const pendingCleanup = new Map<string, string>();

/**
 * 取某类大资源目录（如 'runtime'、'tha-runtime'）的实际使用路径，必要时处理旧位置（userData 下同名目录）：
 *   - 同盘：rename 迁移（瞬间完成，保留依赖与已下载内容）；
 *   - 跨盘：旧副本只是安装包资源的拷贝时，在新位置重新铺设（调用方随后 cleanupLegacy 删旧）；
 *           旧副本含 keepOldIf 判定的重要内容时，继续用旧位置，避免启动时同步拷贝 GB 级文件。
 * 首次启动时 THA 可能在用户选安装位置之前就铺到了 userData，下次启动按上述规则归位。
 */
export function largeDataDir(name: string, log: Log = () => {}, opts: LargeDirOptions = {}): string {
  const userData = app.getPath('userData');
  const target = path.join(largeDataRoot(), name);
  const old = path.join(userData, name);
  if (samePath(target, old) || fs.existsSync(target) || !fs.existsSync(old)) return target;

  if (sameVolume(target, old)) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(old, target);
      log(`[data-dir] 已迁移 ${old} → ${target}`);
      return target;
    } catch (e) {
      log(`[data-dir] 迁移失败，继续使用旧位置 ${old}：${e instanceof Error ? e.message : String(e)}`);
      return old;
    }
  }
  if (opts.keepOldIf?.(old)) {
    log(`[data-dir] ${name} 旧副本（${old}）含已下载内容且在其他盘，继续使用旧位置`);
    return old;
  }
  if (!pendingCleanup.has(name)) {
    log(`[data-dir] ${name} 将在新位置 ${target} 重新铺设，完成后删除旧副本 ${old}`);
    pendingCleanup.set(name, old);
  }
  return target;
}

/** 新位置铺设完成后调用：删除跨盘放弃的旧副本。失败只记日志（可手动删除）。 */
export function cleanupLegacy(name: string, log: Log = () => {}): void {
  const old = pendingCleanup.get(name);
  if (!old) return;
  pendingCleanup.delete(name);
  try {
    fs.rmSync(old, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    log(`[data-dir] 已删除旧副本 ${old}`);
  } catch (e) {
    log(`[data-dir] 删除旧副本失败（可手动删除 ${old}）：${e instanceof Error ? e.message : String(e)}`);
  }
}
