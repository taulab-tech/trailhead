// Renders resources/logo.svg to resources/icon.png (1024px, transparent) for electron-builder.
// Uses a canvas so the output size doesn't depend on display scaling. Run: npm run icon
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'resources', 'logo.svg'), 'utf8')
  const size = Number(process.env.ICON_SIZE || 1024)
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<html><body></body></html>')
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size}
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, ${size}, ${size})
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
  })`)
  const out = process.env.ICON_OUT || path.join(__dirname, '..', 'resources', 'icon.png')
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('wrote', out)
  app.exit(0)
})
