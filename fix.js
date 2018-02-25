const path = require('path')
var Server = require(path.join(__dirname, 'src','server'));
var Client = require(path.join(__dirname, 'src','client'));

exports.createServer = function(stream, opt) {
    return new Server(stream, opt);
};

exports.createClient = function(stream, opt) {
    return new Client(stream, opt);
};

exports.Errors = require(path.join(__dirname, 'src','errors'));
exports.Fields = require(path.join(__dirname, 'src','fields'));
exports.Msgs = require(path.join(__dirname, 'src','msgs'));
