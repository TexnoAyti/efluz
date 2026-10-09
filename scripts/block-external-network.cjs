const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const denied = () => { throw new Error('ISOLATED_TEST_NETWORK_BLOCKED'); };
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
const originalConnect = net.Socket.prototype.connect;
const originalFetch = global.fetch;
const originalRequest = http.request;
const originalGet = http.get;
https.request = https.get = denied;
function checkHttp(input) {
  const host = typeof input === 'string' || input instanceof URL ? new URL(input).hostname : input?.hostname || input?.host || 'localhost';
  if (!local(host)) denied();
}
http.request = function(input, ...rest) { checkHttp(input); return originalRequest.call(this,input,...rest); };
http.get = function(input, ...rest) { checkHttp(input); return originalGet.call(this,input,...rest); };
net.Socket.prototype.connect = function(...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' ? options.host || 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!local(host) || options?.path) denied();
  return originalConnect.apply(this,args);
};
global.fetch = function(input,...args) {
  if (!local(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname)) denied();
  return originalFetch.call(this,input,...args);
};
syncBuiltinESMExports();
