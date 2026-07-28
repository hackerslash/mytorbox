const app = require('./src/server')
const stats = require('./src/stats')
const { PORT } = require('./src/config')

const server = app.listen(PORT, () => {
  console.log(`MyTorbox addon running at http://127.0.0.1:${PORT}/manifest.json`)
})
let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    server.close()
    try {
      await stats.flushNow()
    } catch {
    }
    process.exit(0)
  })
}
