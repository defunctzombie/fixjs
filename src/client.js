// builtin
var EventEmitter = require('events').EventEmitter;
var util = require("util");

// local
var FixFrameDecoder = require('./frame_decoder');
var Session = require('./session');

var Client = function(stream, opt) {
    var self = this;

    EventEmitter.call(self);

    self.stream = stream;
    var sessions = self.sessions = {};

    var decoder = stream.pipe(FixFrameDecoder());

    // new fix message
    decoder.on('data', function(msg) {
        // filter to appropriate session

        // TODO this should be a combination of target comp id
        // and sender comp id, that was we can have multiple sessions
        // to the same target comp with different sender comp on same connection
        // remember the sender here is actually the target_comp_id when we created
        // the session
        var counter = msg.SenderCompID;
        var session = sessions[counter];
        if (!session) {
            // no such session
            self.emit('error', new Error('no session: ' + counter));
            return;
        }

        session.incoming(msg);
    });
};

util.inherits(Client, EventEmitter);

// create a new session, the session is in a non-logged on state
Client.prototype.session = function(sender_comp_id, target_comp_id) {
    var self = this;
    var sessions = self.sessions;
    var stream = self.stream;

    // TODO(shtylman) we should have a stream;

    var session = new Session(false, {
        sender: sender_comp_id,
        target: target_comp_id,
    });

    var session_id = target_comp_id;

    // when session is done, remove it
    session.on('end', function() {
        delete sessions[session_id];
    });

    session.on('send', function(msg) {
        var out = msg.serialize();
        stream.write(out);
    });

    // end the session when stream ends
    stream.on('end', function() {
        session.end();
    });

    sessions[session_id] = session;
    return session;
};

module.exports = Client;
