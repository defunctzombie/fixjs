// builtin
const path = require('path');
var events = require('events');

// local
var FixFrameDecoder = require(path.join(__dirname, 'frame_decoder'));
var Session = require(path.join(__dirname, 'session'));

var Server = function(opt) {
    var self = this;

    // map of session ids that are currently active
    // the value in the map is an object with fields 'stream', and 'session'
    // this is to ensure that only the connected stream is accessing the session
    self.sessions = {};
};

Server.prototype.__proto__ = events.EventEmitter.prototype;

// attach the server to this stream
// servers should be attached to multiple streams
Server.prototype.attach = function(stream) {
    var self = this;
    var sessions = self.sessions;

    var decoder = stream.pipe(FixFrameDecoder());

    decoder.on('error', function(err) {
        self.emit('error', err, stream);
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

        // check if already have a session
        // if new session
        var session_id = msg.SenderCompID;
        var details = sessions[session_id];

        if (details) {
            // if the two streams are not the same, someone is trying to spoof us
            if (details.stream !== stream) {
                // terminate immediately
                return stream.end();
            }

            return details.session.incoming(msg);
        }

        // no session for this session id yet, create it
        var session = new Session(true, {
            // flipped because we are now the sender
            sender: msg.TargetCompID,
            target: msg.SenderCompID,
        });

        // see note above for session variable on why this is
        details = sessions[session_id] = {
            stream: stream,
            session: session,
        }

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

        stream.on('close', function() {
            session.end();
        });

        // outgoing messages
        session.on('send', function(msg) {
            var out = msg.serialize();
            stream.write(out);
        });

        self.emit('session', session, stream);

        // TODO check for other headers to be consistent?

        details.session.incoming(msg);
    });

    stream.on('end', function() {
        // anything?
    })
};

module.exports = Server;
