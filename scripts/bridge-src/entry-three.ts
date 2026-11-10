/**
 * three 桥 chunk：@react-three/fiber 声明式 3D + drei 常用组件，打进同一 chunk
 * （保证 three 实例唯一；AI 侧 'three' 与 'three/drei' 两个 import 名都指向本文件）。
 * 禁命令式 new WebGLRenderer——一律 <Canvas> 声明式写法。
 */
export { Canvas, useFrame, useThree, useLoader, extend } from '@react-three/fiber'
export {
  OrbitControls,
  TransformControls,
  Html,
  Text,
  Grid,
  Sky,
  Stars,
  Environment,
  ContactShadows,
  Float,
  Line,
  Billboard,
  Center,
  RoundedBox
} from '@react-three/drei'
