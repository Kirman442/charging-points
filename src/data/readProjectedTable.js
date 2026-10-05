import { Table, tableFromIPC } from 'apache-arrow'

// parquet-wasm 0.6.1 readParquet ignores columns. Its streamed RecordBatches
// have the projected schema, so consume each batch with that schema intact.
export async function readProjectedTable(bytes, columns, { ParquetFile, readSchema }) {
  const schemaTable = tableFromIPC(readSchema(bytes).intoIPCStream())
  for (const name of columns) if (!schemaTable.getChild(name)) throw new Error(`Отсутствует колонка ${name}`)
  const file = await ParquetFile.fromFile(new Blob([bytes]))
  let reader, finished = false
  try {
    reader = (await file.stream({ columns, batchSize: 16384 })).getReader()
    const batches = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { finished = true; break }
      batches.push(...tableFromIPC(value.intoIPCStream()).batches)
    }
    const table = batches.length ? new Table(batches)
      : schemaTable.select(columns)
    for (const name of columns) if (!table.getChild(name)) throw new Error(`Отсутствует колонка ${name}`)
    return table
  } finally {
    if (reader) {
      if (!finished) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    file.free()
  }
}
