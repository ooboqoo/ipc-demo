import { Socket } from 'net'

/*!
 * 传输帧数据格式:
 * * 头部 (4字节) - ['P', 'F', Version, Type]
 * * 来源和目标地址长度 (2字节) - [srouceNameSize, destinationNameSize]
 * * 传输帧的总字节数(头部 + 内容) (4字节)
 * * 传输内容的字节数 (4字节)
 * * 具体来源和目标地址 (若干字节)
 * * 传输内容 (若干字节)
 */

/** 协议版本 */
const PROTOCOL_VERSION = 0

/** 传输的数据类型 */
export const FrameType = {
  BINARY: 0,
  TEXT_UTF8: 1,
  TEXT_JSON_OBJECT: 2
}

/** 数据读取步骤(进度) */
export const ReadStep = {
  HEADER: 0,
  ORIGIN: 1,
  DATA: 2,
  COMPLETE: 3
}

export interface Frame {
  step?: number
  version?: number
  type?: number
  src?: any
  dst?: any
  data?: any
  size?: number  // 整个传输帧的字节数(头部 + 内容)
  srcSize?: number
  dstSize?: number
  dataSize?: number
}

/**
 * 读取数据包
 * @param frame 未完成读取任务时，需将上次返回的 frame 传递进来
 * @throws {Error} 收到的数据格式不对会抛出异常
 */
export function readFrame (buffers: Buffer[], frame: Frame = {step: ReadStep.HEADER}) {
  let data: Buffer
  let size: number = 0
  // 读取头部信息
  if (frame.step === ReadStep.HEADER) {
    data = readBuffer(buffers, 14)
    if (!data) { return frame }
    // 头部 (4字节) - ['P', 'F', Version, Type]
    if (data[0] !== 80 || data[1] !== 70) {
      throw new Error('unknown data')  // todo: 收到无效包时如何保证后续包正常读取
    }
    frame.version = data[2]
    frame.type = data[3]
    // 传输帧的总字节数(头部 + 内容) (4字节)
    size += data[4] << 24
    size += data[5] << 16
    size += data[6] << 8
    size += data[7]
    frame.size = size
    // 来源和目标地址长度 (2字节)
    frame.srcSize = data[8]
    frame.dstSize = data[9]
    // 传输内容的字节数 (4字节)
    size = 0
    size += data[10] << 24
    size += data[11] << 16
    size += data[12] << 8
    size += data[13]
    frame.dataSize = size
    frame.step = ReadStep.ORIGIN
  }
  // 读取来源和目标地址
  if (frame.step === ReadStep.ORIGIN) {
    data = readBuffer(buffers, frame.srcSize + frame.dstSize)
    if (!data) { return frame }
    frame.src = data.slice(0, frame.srcSize).toString()
    frame.dst = data.slice(frame.srcSize).toString()
    frame.step = ReadStep.DATA
  }
  // 读取数据
  if (frame.step === ReadStep.DATA) {
    data = readBuffer(buffers, frame.dataSize)
    if (!data) { return frame }
    switch (frame.type) {
      case FrameType.TEXT_UTF8: frame.data = data.toString(); break
      case FrameType.TEXT_JSON_OBJECT: frame.data = JSON.parse(data.toString()); break
      case FrameType.BINARY: frame.data = data; break
    }
    frame.step = ReadStep.COMPLETE
    return frame
  }
}

/**
 * 读取指定长度的内容，已读取内容会从 buffers 中删掉
 */
function readBuffer (buffers: Buffer[], size: number): Buffer {
  if (size <= 0) { return }
  const bufferSize = buffers.reduce((acc, buf) => acc + buf.length, 0)
  if (size > bufferSize) { return }
  let cache: Buffer[] = []
  let remains: number = size
  let currentSize: number
  let buf: Buffer
  while (remains > 0) {
    buf = buffers.shift()
    if (currentSize <= remains) {
      remains -= currentSize
      cache.push(buf)
    } else {
      const got = buf.slice(0, remains)
      const ret = buf.slice(remains)
      remains = 0
      cache.push(got)
      buffers.unshift(ret)
    }
  }
  return Buffer.concat(cache, size)
}

/**
 * 发送数据包
 * @param dst 目标地址，仅支持 ASCII 字符
 * @param src 发送地址，仅支持 ASCII 字符
 * @param type 传输的数据类型
 * @throws {Error} 写入管道时可能报错
 */
export function sendFrame (pipe: Socket, dst: string, src: string, type: number, buf: Buffer) {
  if (buf === undefined || buf === null) { return }

  let srcLen = src.length
  let dstLen = dst.length
  let bufLen = buf.length
  let totalSize = 14 + srcLen + dstLen + bufLen;
  let data = new Uint8Array(14)

  // 头部 (4字节) - ['P', 'F', Version, Type]
  data[0] = 80
  data[1] = 70
  data[2] = PROTOCOL_VERSION
  data[3] = type

  // 传输帧的总字节数(头部 + 内容) (4字节)
  data[4] = totalSize >> 24
  data[5] = totalSize >> 16
  data[6] = totalSize >> 8
  data[7] = totalSize

  // 来源和目标地址长度 (2字节)
  data[8] = srcLen
  data[9] = dstLen

  // 传输内容的字节数 (4字节)
  data[10] = bufLen >> 24
  data[11] = bufLen >> 16
  data[12] = bufLen >> 8
  data[13] = bufLen

  pipe.write(data)
  pipe.write(src + dst)
  pipe.write(buf)
}
