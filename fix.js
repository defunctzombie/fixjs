var Server = require('./src/server');
var Client = require('./src/client');

exports.createServer = function(stream, opt) {
    return new Server(stream, opt);
};

exports.createClient = function(stream, opt) {
    return new Client(stream, opt);
};

exports.Errors = require('./src/errors');
exports.Fields = require('./src/fields');
exports.Msgs = require('./src/msgs');
