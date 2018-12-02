import * as net from 'net'
import { readFrame, sendFrame, FrameType, ReadStep, Frame } from './protocol'

const Errors = {
  ERR_CONN_ERROR: "err_conn_error", // 连接异常, 需要重连
  ERR_CONNECT: "err_connect", // 连接失败, 需要不断重连
  ERR_SEND: "err_send", // 发送数据失败, 如需重发, 可能需要记录上次发送的数据
}

export class Client {
  name: string
  pipe: net.Socket
  buffers: Array<Buffer>
  currentFrame: Frame
  server: Frame
  localService: any
  services: { [name: string]: Service }

  onReady: Function
  onData: Function
  onError: Function

  constructor(localService: any) {
    this.localService = Object.assign({
      name: 'client',
      features: [],
      pid: process.pid,
    }, localService)
    this.reset()
    this.services = {}
  }
  reset () {
    this.pipe = null
    this.buffers = []
    this.currentFrame = null
    this.server = null
  }
  connect (address: string) {
    if (this.pipe) { return }
    try {
      this.reset()
      let pipe = net.connect(address)
      pipe.setEncoding('binary')
      pipe.on('data', this.processData.bind(this))
      pipe.on('error', (err: any) => {
        this.disconnect()
        this.emitError(err, Errors.ERR_CONN_ERROR)
      })
      this.pipe = pipe
    } catch (err) {
      this.emitError(err, Errors.ERR_CONNECT)
      return err
    }
  }
  disconnect () {
    if (this.pipe) {
      this.pipe.end()
      this.reset()
    }
  }
  emitError (err: any, reason: string) {
    if (this.onError) { this.onError(err, reason) }
  }
  processData (buf: string | Buffer) {
    if (typeof buf === 'string') { buf = Buffer.from(buf) }
    this.buffers.push(buf)
    const frame = readFrame(this.buffers, this.currentFrame)
    if (frame.step === ReadStep.COMPLETE) {
      if (!this.server) {
        this.server = frame
        this.sendJson(frame.src, this.localService)
        if (this.onReady) { this.onReady() }
      } else if (this.onData) {
        this.onData(frame)
      }
    }
  }

  send (dst: string, type: number, buf: Buffer) {
    sendFrame(this.pipe, dst, this.localService.name, type, buf)
  }
  sendText (service: string, str: string) {
    if (typeof str !== 'string') {
      throw new Error("sendText require string")
    }
    this.send(service, FrameType.TEXT_UTF8, Buffer.from(str))
  }
  sendData (service: string, buf: any) {
    this.send(service, FrameType.BINARY, buf)
  }
  sendJson (service: string, obj: Object) {
    const str = JSON.stringify(obj)
    this.send(service, FrameType.TEXT_JSON_OBJECT, Buffer.from(str))
  }
  // 发送数据到其他服务
  service (name: string) {
    if (this.services[name]) {
      return this.services[name]
    }
    return this.services[name] = new Service(this, name)
  }
}

export class Service {
  client: Client
  name: string
  constructor(client: Client, name: string) {
    this.client = client
    this.name = name
  }
  sendText (buf: string) {
    return this.client.sendText(this.name, buf)
  }
  sendData (buf: any) {
    return this.client.sendData(this.name, buf)
  }
  sendJson (buf: Object) {
    return this.client.sendJson(this.name, buf)
  }
}
