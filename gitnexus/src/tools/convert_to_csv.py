import csv
import json
import os
import pathlib
import subprocess
import sys
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _println(msg: str) -> None:
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def _eprintln(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _get_homedir() -> str:
    return os.path.expanduser("~")


def _read_json_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _resolve_repo(repo_arg: str) -> Tuple[str, str]:
    repo_arg = repo_arg.strip().strip('"').strip("'")
    if not repo_arg:
        raise RuntimeError("repo 参数为空")

    if os.path.exists(repo_arg):
        repo_path = os.path.abspath(repo_arg)
        storage_path = os.path.join(repo_path, ".gitnexus")
        lbug_path = os.path.join(storage_path, "lbug")
        if os.path.exists(lbug_path):
            return repo_path, storage_path
        raise RuntimeError(f"未找到 LadybugDB 文件：{lbug_path}")

    registry_path = os.path.join(_get_homedir(), ".gitnexus", "registry.json")
    if not os.path.exists(registry_path):
        raise RuntimeError(f"未找到全局仓库注册表：{registry_path}（请先运行一次 npx gitnexus analyze）")

    entries = _read_json_file(registry_path)
    if not isinstance(entries, list):
        raise RuntimeError(f"全局仓库注册表格式异常：{registry_path}")

    repo_lower = repo_arg.lower()
    hit: Optional[Dict[str, Any]] = None
    for e in entries:
        if not isinstance(e, dict):
            continue
        name = str(e.get("name", ""))
        repo_path = str(e.get("path", ""))
        if name.lower() == repo_lower or repo_path.lower() == repo_lower:
            hit = e
            break

    if not hit:
        names = [str(e.get("name", "")) for e in entries if isinstance(e, dict) and e.get("name")]
        raise RuntimeError(f'在全局注册表中找不到仓库 "{repo_arg}"。可用仓库：{", ".join(names) if names else "（空）"}')

    repo_path = os.path.abspath(str(hit["path"]))
    storage_path = os.path.abspath(str(hit.get("storagePath") or os.path.join(repo_path, ".gitnexus")))
    lbug_path = os.path.join(storage_path, "lbug")
    if not os.path.exists(lbug_path):
        raise RuntimeError(f"已找到仓库，但未找到 LadybugDB 文件：{lbug_path}（请重新 analyze）")
    return repo_path, storage_path


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _gitnexus_npm_package_dir() -> str:
    """本脚本位于 gitnexus/src/tools/，npm 包根目录为其上两级（含 package.json、node_modules）。"""
    here = pathlib.Path(__file__).resolve()
    return str(here.parent.parent.parent)


def _jsonify_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (str, int, float)):
        return v
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return json.dumps(v, ensure_ascii=False, default=str)


def _cell_for_csv(v: Any) -> Any:
    """供 csv.writer 使用：None 写成空单元格，避免个别版本写出字面量 'None'。"""
    x = _jsonify_value(v)
    return "" if x is None else x


def _run_node_export(lbug_path: str) -> Iterable[Dict[str, Any]]:
    node_cwd = _gitnexus_npm_package_dir()

    node_script = r'''
const lbug = require('@ladybugdb/core');

function rowValue(row, key, idx) {
  if (row && typeof row === 'object' && !Array.isArray(row) && key in row) return row[key];
  if (Array.isArray(row)) return row[idx];
  return undefined;
}

async function run() {
  const dbPath = process.argv[1];
  if (!dbPath) {
    console.error('缺少参数：dbPath');
    process.exit(2);
  }

  const NODE_TABLES = [
    'File','Folder','Function','Class','Interface','Method','CodeElement','Community','Process',
    'Struct','Enum','Macro','Typedef','Union','Namespace','Trait','Impl','TypeAlias','Const','Static',
    'Property','Record','Delegate','Annotation','Constructor','Template','Module'
  ];

  const NEEDS_BACKTICK = new Set([
    'Struct','Enum','Macro','Typedef','Union','Namespace','Trait','Impl','TypeAlias','Const','Static',
    'Property','Record','Delegate','Annotation','Constructor','Template','Module'
  ]);

  const LOCK_RETRY_ATTEMPTS = 10;
  const LOCK_RETRY_DELAY_MS = 250;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let db = null;
  let lastOpenErr = null;
  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      db = new lbug.Database(
        dbPath,
        0,
        false,
        true,
      );
      break;
    } catch (err) {
      lastOpenErr = err;
      const msg = err && err.message ? err.message : String(err);
      const isLock = msg.includes('Could not set lock') || msg.toLowerCase().includes('lock');
      if (!isLock || attempt === LOCK_RETRY_ATTEMPTS) break;
      await sleep(LOCK_RETRY_DELAY_MS * attempt);
    }
  }
  if (!db) {
    const msg = lastOpenErr && lastOpenErr.message ? lastOpenErr.message : String(lastOpenErr || '未知错误');
    console.error(msg);
    process.exit(1);
  }

  const conn = new lbug.Connection(db);

  const BATCH = 1000;
  process.stdout.write(JSON.stringify({ kind: 'meta', dbPath, batch: BATCH, nodeTables: NODE_TABLES }) + '\n');

  try {
    for (const table of NODE_TABLES) {
      const label = NEEDS_BACKTICK.has(table) ? '`' + table + '`' : table;
      const countRes = await conn.query(`MATCH (n:${label}) RETURN count(n) AS cnt`);
      const countRows = await countRes.getAll();
      const cnt = Number(rowValue(countRows[0], 'cnt', 0) || 0);
      process.stdout.write(JSON.stringify({ kind: 'table_begin', table, count: cnt }) + '\n');
      for (let offset = 0; offset < cnt; offset += BATCH) {
        const q = `MATCH (n:${label}) RETURN n SKIP ${offset} LIMIT ${BATCH}`;
        const res = await conn.query(q);
        const rows = await res.getAll();
        for (const row of rows) {
          const n = rowValue(row, 'n', 0) || {};
          process.stdout.write(JSON.stringify({ kind: 'node', table, data: n }) + '\n');
        }
        process.stdout.write(JSON.stringify({ kind: 'table_progress', table, offset: Math.min(offset + BATCH, cnt), count: cnt }) + '\n');
      }
      process.stdout.write(JSON.stringify({ kind: 'table_end', table, count: cnt }) + '\n');
    }

    const relCountRes = await conn.query(`MATCH ()-[r:CodeRelation]->() RETURN count(r) AS cnt`);
    const relCountRows = await relCountRes.getAll();
    const relCnt = Number(rowValue(relCountRows[0], 'cnt', 0) || 0);
    process.stdout.write(JSON.stringify({ kind: 'rel_begin', count: relCnt }) + '\n');
    for (let offset = 0; offset < relCnt; offset += BATCH) {
      const q = `
        MATCH (from)-[r:CodeRelation]->(to)
        RETURN from.id AS fromId, to.id AS toId, r.type AS type, r.confidence AS confidence, r.reason AS reason, r.step AS step
        SKIP ${offset} LIMIT ${BATCH}
      `;
      const res = await conn.query(q);
      const rows = await res.getAll();
      for (const row of rows) {
        const fromId = rowValue(row, 'fromId', 0);
        const toId = rowValue(row, 'toId', 1);
        const type = rowValue(row, 'type', 2);
        const confidence = rowValue(row, 'confidence', 3);
        const reason = rowValue(row, 'reason', 4);
        const step = rowValue(row, 'step', 5);
        process.stdout.write(JSON.stringify({
          kind: 'rel',
          data: { fromId, toId, type, confidence, reason, step }
        }) + '\n');
      }
      process.stdout.write(JSON.stringify({ kind: 'rel_progress', offset: Math.min(offset + BATCH, relCnt), count: relCnt }) + '\n');
    }
    process.stdout.write(JSON.stringify({ kind: 'rel_end', count: relCnt }) + '\n');

    let embCnt = 0;
    try {
      const embCountRes = await conn.query(`MATCH (e:CodeEmbedding) RETURN count(e) AS cnt`);
      const embCountRows = await embCountRes.getAll();
      embCnt = Number(rowValue(embCountRows[0], 'cnt', 0) || 0);
    } catch {
      embCnt = 0;
    }
    process.stdout.write(JSON.stringify({ kind: 'emb_begin', count: embCnt }) + '\n');
    for (let offset = 0; offset < embCnt; offset += BATCH) {
      const q = `MATCH (e:CodeEmbedding) RETURN e SKIP ${offset} LIMIT ${BATCH}`;
      const res = await conn.query(q);
      const rows = await res.getAll();
      for (const row of rows) {
        const e = rowValue(row, 'e', 0) || {};
        process.stdout.write(JSON.stringify({ kind: 'emb', data: e }) + '\n');
      }
      process.stdout.write(JSON.stringify({ kind: 'emb_progress', offset: Math.min(offset + BATCH, embCnt), count: embCnt }) + '\n');
    }
    process.stdout.write(JSON.stringify({ kind: 'emb_end', count: embCnt }) + '\n');

    await conn.close();
    await db.close();
    process.stdout.write(JSON.stringify({ kind: 'done' }) + '\n');
    process.exit(0);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    try { await conn.close(); } catch {}
    try { await db.close(); } catch {}
    console.error(msg);
    process.exit(1);
  }
}

run();
'''

    cmd = ["node", "-e", node_script, lbug_path]

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=node_cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError:
        raise RuntimeError("未找到 node 命令。请先安装 Node.js，并确保 node 在 PATH 中。")

    assert proc.stdout is not None
    assert proc.stderr is not None

    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except Exception:
            continue

    stderr = proc.stderr.read()
    code = proc.wait()
    if code != 0:
        stderr = (stderr or "").strip()
        raise RuntimeError(f"导出失败（node 退出码={code}）：{stderr or '未知错误'}")


def _ensure_csv_writer(
    writers: Dict[str, Tuple[csv.writer, List[str]]],
    files: Dict[str, Any],
    base_dir: str,
    table: str,
    first_row: Dict[str, Any],
) -> Tuple[csv.writer, List[str]]:
    if table in writers:
        return writers[table]

    path = os.path.join(base_dir, f"{table}.csv")
    _ensure_parent_dir(path)
    # utf-8-sig：Excel（Windows）更易正确识别 UTF-8，减少乱码后手工改列导致的错位感
    f = open(path, "w", encoding="utf-8-sig", newline="")
    files[table] = f

    # 列名按第一次出现时的 key 顺序
    columns = list(first_row.keys())
    # QUOTE_ALL：所有字段加引号，含逗号/换行/引号的 content、JSON、reason 等不会挤占相邻列
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(columns)
    writers[table] = (writer, columns)
    return writer, columns


def _write_row(writer: csv.writer, columns: List[str], row: Dict[str, Any]) -> None:
    writer.writerow([_cell_for_csv(row.get(c)) for c in columns])


def _prepare_node_csv_row(table: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Method 的 content 字段体积大，导出 CSV 时省略。"""
    if table != "Method":
        return data
    out = dict(data)
    out.pop("content", None)
    return out


def main(argv: List[str]) -> int:
    if len(argv) != 2:
        _eprintln("用法：python convert_to_csv.py <repo>")
        _eprintln("说明：repo 可以是仓库名称（注册表中的 name）或仓库路径")
        return 2

    repo_arg = argv[1]
    repo_path, storage_path = _resolve_repo(repo_arg)
    lbug_path = os.path.join(storage_path, "lbug")
    csv_dir = os.path.join(storage_path, "lbug-csv")

    _println(f"目标仓库：{repo_path}")
    _println(f"LadybugDB：{lbug_path}")
    _println(f"输出 CSV 目录：{csv_dir}")

    if os.path.exists(csv_dir):
        _println(f"CSV 目录已存在，将覆盖同名文件：{csv_dir}")

    writers: Dict[str, Tuple[csv.writer, List[str]]] = {}
    files: Dict[str, Any] = {}

    try:
        _println("开始从 LadybugDB 导出为 CSV（可能耗时较长）...")

        for msg in _run_node_export(lbug_path):
            kind = msg.get("kind")

            if kind == "table_begin":
                table = str(msg.get("table", ""))
                count = int(msg.get("count") or 0)
                _println(f"导出节点表 {table}：{count} 条")
                continue

            if kind == "node":
                table = str(msg.get("table", ""))
                raw = msg.get("data") or {}
                data = _prepare_node_csv_row(table, raw if isinstance(raw, dict) else {})
                writer, columns = writers.get(table, (None, []))  # type: ignore[assignment]
                if writer is None:
                    writer, columns = _ensure_csv_writer(writers, files, csv_dir, table, data)
                _write_row(writer, columns, data)
                continue

            if kind == "table_end":
                table = str(msg.get("table", ""))
                _println(f"写入节点表 {table}.csv 完成")
                continue

            if kind == "rel_begin":
                _println(f"导出关系表 CodeRelation：{int(msg.get('count') or 0)} 条")
                continue

            if kind == "rel":
                data = msg.get("data") or {}
                table = "CodeRelation"
                writer, columns = writers.get(table, (None, []))  # type: ignore[assignment]
                if writer is None:
                    writer, columns = _ensure_csv_writer(writers, files, csv_dir, table, data)
                _write_row(writer, columns, data)
                continue

            if kind == "rel_end":
                _println("写入关系表 CodeRelation.csv 完成")
                continue

            if kind == "emb_begin":
                _println(f"导出向量表 CodeEmbedding：{int(msg.get('count') or 0)} 条")
                continue

            if kind == "emb":
                data = msg.get("data") or {}
                table = "CodeEmbedding"
                writer, columns = writers.get(table, (None, []))  # type: ignore[assignment]
                if writer is None:
                    writer, columns = _ensure_csv_writer(writers, files, csv_dir, table, data)
                _write_row(writer, columns, data)
                continue

            if kind == "emb_end":
                _println("写入向量表 CodeEmbedding.csv 完成")
                continue

            if kind == "done":
                break

        _println("CSV 转换完成")
        return 0
    finally:
        # 关闭所有已打开的文件
        for f in files.values():
            try:
                f.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

