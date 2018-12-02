const { Client } = require('../dist/client')

const a = new Client({name: 'a'})
a.onReady = () => console.log('ready')
a.onData = (data) => console.log(data)

a.connect()

a.sendText('master', 'Hello Master')

