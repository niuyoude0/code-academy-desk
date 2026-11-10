/**
 * react 桥 chunk 入口：组件环境用到的 react 家族全导出。
 * 其余 chunk 以 './react.js' 为 external 引用它（见 build-bridge-libs.mjs）。
 */
export {
  default,
  useState,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useInsertionEffect,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  useImperativeHandle,
  useOptimistic,
  use,
  Fragment,
  StrictMode,
  Suspense,
  createContext,
  createElement,
  cloneElement,
  isValidElement,
  lazy,
  memo,
  forwardRef,
  createRef,
  Component,
  PureComponent,
  startTransition,
  Children,
  version
} from 'react'
// jsx automatic（esbuild 编译用户代码时产出 react/jsx-runtime 导入，重写到本 chunk）
export { jsx, jsxs } from 'react/jsx-runtime'
export { createPortal, flushSync, version as reactDomVersion } from 'react-dom'
export { createRoot, hydrateRoot } from 'react-dom/client'
