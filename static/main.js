var socket = new WebSocket(makeWebsocketUrl())

function makeWebsocketUrl() {
  let scheme = 'ws'
  if (location.protocol === 'https:') {
    scheme = 'wss'
  }

  return scheme + '://' + location.host
}

socket.addEventListener('open', function (event) {
  //socket.send('Hello Server!');
  console.log('Connection to proxy open')
})

socket.addEventListener('close', function (event) {
  //socket.send('Hello Server!');
  console.log('Connection to proxy closed')
})

socket.addEventListener('message', function (event) {
  let ob = JSON.parse(event.data)
  if (!('hashtx' in ob)) {
    console.log('Message from server', ob)
  }
});
