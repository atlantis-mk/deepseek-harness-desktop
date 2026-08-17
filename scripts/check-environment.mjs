import process from 'node:process'
import {
  findCompatibleSystemNode,
  getNodeArtifact,
} from '../src/node-runtime.mjs'

const artifact = getNodeArtifact(process.platform, process.arch)
const system = await findCompatibleSystemNode()

console.log(`平台: ${process.platform}/${process.arch}`)
console.log(`私有运行时包: ${artifact.file}`)
if (system) {
  console.log(`系统 Node: ${system.nodePath}`)
  console.log(`Node 版本: ${system.version}`)
  console.log(`npx 入口: ${system.npxCliPath}`)
} else {
  console.log('未找到兼容的系统 Node；应用启动时将下载私有运行时。')
}
