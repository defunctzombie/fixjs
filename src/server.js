// builtin
var EventEmitter = require('events').EventEmitter;
var util = require("util");

// local
var FixFrameDecoder = require('./frame_decoder');
var Session = require('./session');

var Server = function(opt) {
    var self = this;

    EventEmitter.call(self);

    // map of session ids that are currently active
    // the value in the map is an object with fields 'stream', and 'session'
    // this is to ensure that only the connected stream is accessing the session
    self.sessions = {};
};

util.inherits(Server, EventEmitter);

// attach the server to this stream
// servers should be attached to multiple streams
Server.prototype.attach = function(stream) {
    var self = this;
    var sessions = self.sessions;

    var decoder = stream.pipe(FixFrameDecoder());

    decoder.on('error', function(err) {
        self.emit('error', err);
    });

    // user has 30 seconds to establish any session, otherwise they are disconnected
    var logon_timeout = setTimeout(function() {
        stream.end();
    }, 1000 * 30);

    // TODO(shtylman) when stream ends, everything is done
    stream.on('end', function() {
        clearTimeout(logon_timeout);
    });

    // TODO(shtylman) emit on successful login?

    var session_count = 0;

    // new fix message
    decoder.on('data', function(msg) {

        // this is a huge problem
        // a person could technically connect with a spoofed SenderCompID
        // and then be re-attached to the session of a previous person

        var session_id = msg.SenderCompID;
        var session = sessions[session_id];

        if (session) {
            // Prevent simultaneous connections with same session_id.
            // If the two streams are not the same, someone may be trying to spoof us.
            if (session.stream !== stream) {
                // terminate immediately
                return stream.end();
            }

            return session.incoming(msg);
        }

        // no session for this session id yet, create it
        session = new Session(true, {
            // flipped because we are now the sender
            sender: msg.TargetCompID,
            target: msg.SenderCompID,
        });

        session.stream = stream;
        ++session_count;

        // when session is done, remove it from
        session.on('end', function() {
            --session_count;
            delete sessions[session_id];

            // if the last session is over, end the connection
            if (session_count === 0) {
                clearTimeout(logon_timeout);
                stream.end();
            }
        });

        session.on('logon', function() {
            clearTimeout(logon_timeout);
        });

        stream.on('end', function() {
            session.end();
        });

        stream.on('close', function() {
            session.end();
        });

        // outgoing messages
        session.on('send', function(msg) {
            var out = msg.serialize();
            stream.write(out);
        });

        sessions[session_id] = session;
        self.emit('session', session);

        session.incoming(msg);
    });

    stream.on('end', function() {
        // anything?
    })
};

module.exports = Server;
