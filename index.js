const app = require('./src/server')
const { PORT } = require('./src/config')

app.listen(PORT, () => {
  console.log(`MyTorbox addon running at http://127.0.0.1:${PORT}/manifest.json`)
})
