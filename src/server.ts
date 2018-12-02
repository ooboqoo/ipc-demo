import * as net from 'net'
import { readFrame, sendFrame, parseFrameBody, FrameType, ReadStep, Frame } from './protocol'

const PIPE_NAME = 'mypipe'
const PIPE_PATH = '\\\\.\\pipe\\' + PIPE_NAME
const MASTER_SERVICE_NAME = 'master'

const clients: {[x: string]: net.Socket} = {}
const buffers: Buffer[] = []
let currentFrame: Frame = {}

const log = console.log

const server = net.createServer(function (pipe) {
  log('[Server] new connection')
  masterService.pipe = pipe

  const buf = Buffer.from(JSON.stringify(masterService.localService))
  sendFrame(pipe, '', MASTER_SERVICE_NAME, FrameType.TEXT_JSON_OBJECT, buf)

  pipe.on('data', function processFirstFrame (buf: Buffer) {
    buffers.push(buf)
    const frame = readFrame(buffers, currentFrame)
    if (frame.step === ReadStep.COMPLETE) {
      clients[frame.src] = pipe
      pipe.off('data', processFirstFrame)
      pipe.on('data', processData)
      // 处理同时到达的多条消息
      processData()
    }
  })

  pipe.on('end', function () {
    log('[Server socket] end')
  })
})

server.on('close', function () {
  log('[Server] closed')
})

server.listen(PIPE_PATH, function () {
  log('[Server] start listening')
})
  
function processData (buf?: Buffer) {
  if (buf) { buffers.push(buf) }
  const frame = readFrame(buffers, currentFrame, false)
  if (frame.step === ReadStep.COMPLETE) {
    if (frame.dst === MASTER_SERVICE_NAME) {
      parseFrameBody(frame)
      masterService.onData(frame)  // 业务处理
    } else if (clients[frame.dst]) {
      sendFrame(clients[frame.dst], frame.dst, frame.src, frame.type, frame.buf)  // 消息转发
    }
    // 处理同时到达的多条消息
    processData()
  }
}

const masterService = {
  pipe: new net.Socket(),
  localService: {
    name: MASTER_SERVICE_NAME
  },
  onData (frame: Frame) {
    this.sendText(frame.src, 'Hello ' + frame.src)
    log(frame)
  },
  send (dst: string, type: number, buf: Buffer) {
    sendFrame(this.pipe, dst, this.localService.name, type, buf)
  },
  sendText (service: string, str: string) {
    if (typeof str !== 'string') {
      throw new Error("sendText require string")
    }
    this.send(service, FrameType.TEXT_UTF8, Buffer.from(str))
  },
  sendData (service: string, buf: any) {
    this.send(service, FrameType.BINARY, buf)
  },
  sendJson (service: string, obj: Object) {
    const str = JSON.stringify(obj)
    this.send(service, FrameType.TEXT_JSON_OBJECT, Buffer.from(str))
  }
}