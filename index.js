#!/usr/bin/env node

require('dotenv').config({ path: process.env.SECRETS_PATH || './' })
const http = require('http')
const https = require('https')
const net = require('net')
const { URL } = require('url')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const WebSocket = require('ws')
const expressWs = require('express-ws')
const zmq = require('zeromq')
const session = require('express-session')
const redis = require('redis')
const jayson = require('jayson/promise')
//const mariadb = require('mariadb')
const yargs = require('yargs/yargs')

const SSL_KEY_FILE_PATH = "/root/.config/xcp-proxy/ssl/xcp_proxy.key" 
const SSL_CERT_FILE_PATH = "/root/.config/xcp-proxy/ssl/xcp_proxy.pem"

const DEFAULT_SSL_KEY_FILE_PATH = "/root/.config/xcp-proxy-default/ssl/xcp_proxy.key" 
const DEFAULT_SSL_CERT_FILE_PATH = "/root/.config/xcp-proxy-default/ssl/xcp_proxy.pem"


const HTTP_PORT = parseInt(process.env.HTTP_PORT || 8097)
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || 8098)
const ADDRINDEXRS_URL = new URL(process.env.ADDRINDEXRS_URL || 'tcp://localhost:8432')
const COUNTERPARTY_URL = process.env.COUNTERPARTY_URL || 'http://rpc:rpc@localhost:4000'
const BITCOIN_ZMQ_URL = process.env.BITCOIN_ZMQ_URL || 'tcp://localhost:28832'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/8'
const DEFAULT_SESSION_SECRET = 'configure this!'
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET

const INTERVAL_CHECK_COUNTERPARTY_PARSED = parseInt(process.env.INTERVAL_CHECK_COUNTERPARTY_PARSED || '10000')
const INTERVAL_CHECK_COUNTERPARTY_MEMPOOL = parseInt(process.env.INTERVAL_CHECK_COUNTERPARTY_MEMPOOL || '10000')

var localMempool = [] //To detect new mempool txs on counterparty
var firstMempoolCheck = true

var localLastBlock = -1

const xcpClient = jayson.client.http(COUNTERPARTY_URL)

async function startZmq(notifiers) {
  const sock = new zmq.Subscriber

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  sock.connect(BITCOIN_ZMQ_URL)
  if (notifiers && notifiers.hashtx) {
    sock.subscribe('hashtx')
  }

  if (notifiers && notifiers.hashblock) {
    sock.subscribe('hashblock')
  }
  console.log(`ZMQ connected to ${BITCOIN_ZMQ_URL}`)

  for await (const [topic, msg] of sock) {
    const topicName = topic.toString('utf8')

    if (topicName === 'hashtx') {
      const txid = msg.toString('hex')
      notifiers.hashtx(txid)
    } else if (topicName === 'hashblock') {
      const blockhash = msg.toString('hex')
      notifiers.hashblock(blockhash)
      if (notifiers.xcp) {
        setTimeout(waitForCounterpartyBlock(blockhash), INTERVAL_CHECK_COUNTERPARTY_PARSED)
      }
    }
  }
}


async function waitForCounterpartyBlock(notifiers) {
  let found = false
  let xcpInfo = await xcpClient.request('get_running_info', [])
  let newLastBlock = -1
  
  if (xcpInfo.result && xcpInfo.result.last_block && xcpInfo.result.last_block.block_index) {
    newLastBlock = xcpInfo.result.last_block.block_index    
         
    if ((localLastBlock >= 0) && (newLastBlock >= 0) && (localLastBlock < newLastBlock)){
      let blockIndexes = []
      for (var i = localLastBlock+1;i<=newLastBlock;i++){
        blockIndexes.push(i)
      }
      
      let blocks = await xcpClient.request('get_blocks', {block_indexes: blockIndexes})
      let blockMessages = []
    
      for (var nextBlockIndex in blocks.result){
        var nextBlock = blocks.result[nextBlockIndex]
          
        let nextBlockMessages = nextBlock._messages.map(x => {
          try {
            return {
              ...x,
              bindings: JSON.parse(x.bindings)
            }
          } catch(e) {
            return x
          }
        })

        
        blockMessages.push(...nextBlockMessages)          
      }
    
      if (blockMessages.length > 0){
        notifiers.xcp(blockMessages)
      }
      
      localLastBlock = newLastBlock   
    } else {
      localLastBlock = newLastBlock   
    }
  }  
}

async function waitForMempool(notifiers){
  let found = false
  let xcpMempool
  while (!found) {
    xcpMempoolRequest = await xcpClient.request('get_mempool', [])
    if (xcpMempoolRequest.result) {
      found = true
      xcpMempool = xcpMempoolRequest.result
    } else {
      await sleep(INTERVAL_CHECK_COUNTERPARTY_MEMPOOL)
    }
  }

  //First, checks for txs in local mempool that are not longer in counterparty mempool and remove them
  var nextMempoolTxIndex = 0
  while (nextMempoolTxIndex < localMempool.length){
    var nextMempoolTx = localMempool[nextMempoolTxIndex]
  
    let index = findMempoolTx(nextMempoolTx.tx_hash, localMempool)
    
    if (index == -1){
        localMempool.splice(nextMempoolTxIndex, 1)
      } else {
        nextMempoolTxIndex++
    }       
  }

  //Now checks for new txs in counterparty mempool
  var newMempoolTxs = []
  for (var nextMempoolTxIndex in xcpMempool){
      var nextMempoolTx = xcpMempool[nextMempoolTxIndex]
    
      let index = findMempoolTx(nextMempoolTx.tx_hash, localMempool)
    
    if (index == -1){
        localMempool.push(nextMempoolTx)
        newMempoolTxs.push(nextMempoolTx)
    }
  }

  if (!firstMempoolCheck){
      if (newMempoolTxs.length > 0){
        notifiers.xcp(newMempoolTxs.map(x => {
          try {
            return {
              ...x,
              bindings: JSON.parse(x.bindings)
            }
          } catch(e) {
            return x
          }
        }))
      } 
  } else {
    firstMempoolCheck = false
  }
  
}

function findMempoolTx(txHash, mempoolArray){
    //TODO: binary search
    for (var nextMempoolTxIndex in mempoolArray){
        var nextMempoolTx = mempoolArray[nextMempoolTxIndex]
        
        if (nextMempoolTx.tx_hash == txHash){
            return nextMempoolTxIndex
        }
        
    }
    
    return -1
}

async function checkParsedBlocks(notifiers){
    await waitForCounterpartyBlock(notifiers)
    setTimeout(()=>{checkParsedBlocks(notifiers)}, INTERVAL_CHECK_COUNTERPARTY_PARSED)
}

async function checkXcpMempool(notifiers){
    await waitForMempool(notifiers)
    setTimeout(()=>{checkXcpMempool(notifiers)}, INTERVAL_CHECK_COUNTERPARTY_MEMPOOL)
}

function startServer() {
  const app = express()
  const redisClient = redis.createClient(REDIS_URL)
  const RedisStore = require('connect-redis')(session)
  //const server = http.createServer(app)
  const wsInstance = expressWs(app)
  if (process.env.HELMET_ON) {
    app.use(helmet()) // Protect headers
  }
  app.use(cors()) // Allow cors
  app.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret: SESSION_SECRET,
      resave: false,
    })
  )
  app.use(express.static('static'))

  app.get('/api', (req, res) => {
    res.json({})
  })

  const notificationObservers = {
    hashtx: [],
    hashblock: [],
    xcp: []
  }
  const notifiers = {
    hashtx: (data) => {
      //notificationObservers.hashtx.forEach(x => x(data))
    },
    hashblock: (data) => {
      //notificationObservers.hashblock.forEach(x => x(data))
    },
    xcp: (data) => {
      notificationObservers.xcp.forEach(x => x(data))
    }
  }
  //const wss = new WebSocket.Server({ clientTracking: false, noServer: true })
  //server.on('upgrade', function (request, socket, head) {

    /*sessionParser(request, {}, () => {
      // Use this code to allow only api calls that are authed
      if (!request.session.userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      console.log('Session is parsed!');

      wss.handleUpgrade(request, socket, head, function (ws) {
        wss.emit('connection', ws, request);
      });
    });*/

  /*  console.log('User asking upgrade to websocket')
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })

  })*/

  let globalId = 0
  //const clients = {}
  app.ws('/', (ws, request) => {
    const myId = globalId++
    console.log(`User ${myId} connected`)
    //const userId = request.session.userId;
    //clients[myId] = ws

    ws.on('message', (message) => {
      // no need for these rn
    })

    ws.on('close', () => {
      //delete clients[myId]
    })
  })

  const broadcast = (msg) => {
    wsInstance.getWss().clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    })
  }

  notificationObservers.hashblock.push((data) => {
    broadcast(JSON.stringify({ hashblock: data }))
  })

  notificationObservers.hashtx.push((data) => {
    broadcast(JSON.stringify({ hashtx: data }))
  })

  notificationObservers.xcp.push((data) => {
    broadcast(JSON.stringify({ xcp: data }))
  })

  //server.listen(HTTP_PORT, (err) => {
  app.listen(HTTP_PORT, (err) => {
    if (err) {
      console.log(`Error while listening on port ${HTTP_PORT}`, err)
    } else {
      console.log(`Listening on port ${HTTP_PORT}`)

      //setImmediate(() => startZmq(notifiers))
      setImmediate(() => checkParsedBlocks(notifiers))
      setImmediate(() => checkXcpMempool(notifiers))
    }
  })

  if (!(fs.existsSync(SSL_KEY_FILE_PATH) && fs.existsSync(SSL_CERT_FILE_PATH))){
    SSL_KEY_FILE_PATH = DEFAULT_SSL_KEY_FILE_PATH
    SSL_CERT_FILE_PATH = DEFAULT_SSL_CERT_FILE_PATH
  }

  https.createServer({
    key: fs.readFileSync(SSL_KEY_FILE_PATH),
    cert: fs.readFileSync(SSL_CERT_FILE_PATH),
  }, app).listen(HTTPS_PORT)
  console.log(`(HTTPS) Listening on port ${HTTPS_PORT}`)  

  if (SESSION_SECRET === DEFAULT_SESSION_SECRET) {
    console.error(`Using default session secret "${DEFAULT_SESSION_SECRET}", This is very dangerous: pass SESSION_SECRET environment variable to modify it`)
  }
}

// Yargs has built in mechanism to handle commands, but it isn't working here
const {argv} = yargs(yargs.hideBin(process.argv))
if (argv._.length > 0 && argv._[0] === 'server') {
  startServer()
}
