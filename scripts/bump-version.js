const { readFileSync, writeFileSync } = require('fs')

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const [x, y, z] = pkg.version.split('.').map(Number)

let newX = x, newY = y, newZ = z + 1

if (newZ > 10) {
  newZ = 0
  newY += 1
}
if (newY > 10) {
  newY = 0
  newX += 1
}

pkg.version = `${newX}.${newY}.${newZ}`
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log(pkg.version)
