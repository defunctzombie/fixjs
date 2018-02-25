/// fix session
const path = require('path');
var events = require('events');

var Fields = require(path.join(__dirname, 'fields'));
var Msg = require(path.join(__dirname, 'msg'));
var Msgs = require(path.join(__dirname, 'msgs'));
var RejectWithText = require(path.join(__dirname, 'errors')).RejectWithText;

var Session = function(is_acceptor, opt) {
    var self = this;

    self.incoming_seq_num = 1;
    self.outgoing_seq_num = 1;

    self.is_acceptor = is_acceptor;
    self.respond_to_logon = true;

    self.sender_comp_id = opt.sender;
    self.target_comp_id = opt.target;

    // incoming messages need to be processed in the order they are received
    self.msg_queue = [];

    // heartbeat interval
    self.is_logged_in = false;

    // admin handlers
    var admin = self.admin = {};

    self.sendHeartbeats = true;

    self.last_incoming_time = 0;
    self.last_outgoing_time = 0;

    admin.Logon = function(msg, next) {
        var heartbt_milli = +msg.HeartBtInt * 1000;
        if (isNaN(heartbt_milli)) {
            // send back invalid heartbeat
            return next(new RejectWithText('invalid heartbeat interval, must be numeric', Fields.HeartBtInt));
        };

        // heatbeat handler
        var heartbeat_timer = setInterval(function () {
            var currentTime = new Date().getTime();

            // counter party might be dead, kill connection
            if (currentTime - self.last_incoming_time > heartbt_milli * 2 && self.expectHeartbeats) {
                self.emit('error', new Error('no heartbeat from counter party in ' + heartbt_milli + ' milliseconds'));
                self.end();
                return;
            }

            // ask counter party to wake up
            if (currentTime - self.last_incoming_time > (heartbt_milli * 1.5) && self.expectHeartbeats) {
                // TODO send test message
            }

            // heartbeat time!
            if (currentTime - self.last_outgoing_time > heartbt_milli && self.sendHeartbeats) {
                // send here, not next because it is an interval
                self.send(new Msgs.Heartbeat());
            }
        }, heartbt_milli / 2); //End Set heartbeat mechanism==

        // clear heatbeat interval on end
        self.on('end', function () {
            clearInterval(heartbeat_timer);
        });

        // Logon successful
        self.is_logged_in = true;

        // Logon ack (acceptor)
        if (self.is_acceptor && self.respond_to_logon) {
            // send same message back
            // sender comp/target comp will be swapped
            self.send(msg);
        }

        self.emit('logon');
        next();
    };

    admin.Logout = function(msg, next) {
        // we initiated a logout and this is the response
        // we can terminate the session
        // per the fix spec, the logout initiator is the one responsible for terminating
        // the session
        if (self.logout_confirmation) {
            clearTimeout(self.logout_confirmation);

            self.is_logged_in = false;
            self.emit('logout');

            // no more messages will be processed
            // clear queue
            self.msg_queue = [];
            next();

            // our session is done
            return self.end();
        }

        // we got a logout request, respond
        // this gives the counter party a chance to do perform resend requests
        self.send(new Msgs.Logout());

        // TODO should resend requests be the only thing supported here?
        // IE only allow admin messages after a logout confirmation

        next();
    };

    admin.TestRequest = function(msg, next) {
        var heartbeat = new Msgs.Heartbeat();
        heartbeat.TestReqID = msg.TestReqID;
        return next(heartbeat);
    };

    admin.ResendRequest = function(msg, next) {
        // TODO, currently just sends a sequence reset
        var seq_reset = new Msgs.SequenceReset();
        seq_reset.GapFillFlag = 'N';
        seq_reset.NewSeqNo = msg.EndSeqNo;
        return next(seq_reset);
    };

    // note that for SeqReset - Reset the header MsgSeqNum is ignored
    admin.SequenceReset = function(msg, next) {
        var msg_seq_num = +msg.MsgSeqNum;
        var reset_num = +msg.NewSeqNo;

        // gap fill, MsgSeqNum from header is not ignored
        // sequence reversal should be ignored
        if (msg.GapFillFlag === 'Y' && msg_seq_num < self.incoming_seq_num) {
            // message should be discarded
            return next();
        }

        // cannot reset to less
        if (reset_num < self.incoming_seq_num) {
            return next(new RejectWithText('SequenceReset may not decrement sequence numbers', Fields.NewSeqNo));
        }

        self.incoming_seq_num = reset_num;
        next();
    };

    admin.Heartbeat = function(msg, next) {
        next();
    };

    admin.Reject = function(msg, next) {
        self.emit('error', new Error(msg.Text));
        next();
    };

    // our admin handling
    self.on('message', function(msg, next) {
        self._process_incoming(msg, next);
    });

    // handle dispatching messages by name or rejecting if unsupported
    self.on('message', function(msg, next) {
        var listeners = self.listeners(msg.name).concat();
        if (listeners.length === 0) {
            // admin messages don't need to be handled by the app
            if (['0', '1', '2', '3', '4', '5', 'A'].indexOf(msg.MsgType) >= 0) {
                return next();
            }
            return next(new RejectWithText('unsupported message type: ' + msg.MsgType, Fields.MsgType));
        }

        // to make sure each handler completes fully, including async actions,
        // we do this instead of self.emit(msg.name, msg)
        (function next_listener() {
            var handler = listeners.shift();
            if (!handler) {
                return next();
            }

            handler.call(self, msg, function(result) {
                if (result) {
                    return next(result);
                }

                // next message handler
                next_listener();
            });
        })();
    });
};

Session.prototype.__proto__ = events.EventEmitter.prototype;

Session.prototype.reject = function(orig_msg, reason, field) {
    var self = this;

    var msg = new Msgs.Reject();
    msg.RefSeqNum = orig_msg.MsgSeqNum;
    msg.RefMsgType = orig_msg.MsgType;
    if (reason) {
        msg.Text = reason;
    }
    if (field) {
        msg.RefTagID = field.tag || field; // support our Field objects and plain numbers
    }
    return self.send(msg);
};

// process incoming message
Session.prototype.incoming = function(msg) {
    var self = this;

    if (self._stopped) {
        return;
    }

    // messages need to be processed in the order in which they are received
    // it would be wrong to receive order A then order B and for some reason
    // send order B to the matching engine before order A
    if (self.processing) {
        return self.msg_queue.push(msg);
    }

    self.processing = true;

    var message_handlers = self.listeners('message').concat(); //cheap clone

    function next_msg() {
        self.processing = false;
        var msg = self.msg_queue.shift();
        if (!msg) {
            return;
        }
        return self.incoming(msg);
    }

    // we do this because admin handlers should always run last
    // this allows users to hookup their own 'message' handlers and have them always run before
    message_handlers.push(function(msg, next) {
        var admin_handler = self.admin[msg.name];
        if (!admin_handler) {
            return next();
        }
        admin_handler(msg, next);
    });

    (function next() {
        var handler = message_handlers.shift();
        if (!handler) {
            // move on to the next message
            return next_msg();
        }

        // checks that the handler actually returned in a reasonable amount of time
        // TODO let user specify what to do in this case? skip to next message?
        // this would be bad as we did not fully process this message but did mark expected sequence numbers
        // maybe mark sequence number after message is done processing? I kinda like that more
        var execution_timeout = setTimeout(function() {
            var err = new Error('message handler taking too long to execute');
            err.msg = msg.toString();
            err.handler = handler.toString();
            self.emit('error', err);
        }, 10000);

        handler(msg, function(result) {
            clearTimeout(execution_timeout);

            if (msg.MsgType === 'A' && result instanceof Error) {
                if (result instanceof RejectWithText) {
                    // this type of error contains text intended for the counterparty
                    self.reject(msg, result.message, result.field);
                }
                else if (result instanceof Error) {
                    // generic Error message may contain text not intended for the counterparty
                    self.reject(msg);
                }

                // upon rejected logon message, session will be ended
                // no more messages will be processed
                self.msg_queue = [];
                next_msg();

                self._stopped = true;
                setTimeout(function() {
                    self.end();
                }, 1000);
                return;
            }

            if (result instanceof RejectWithText) {
                // this type of error contains text intended for the counterparty
                self.reject(msg, result.message, result.field);
                return next_msg();
            } else if (result instanceof Error) {
                // generic Error message may contain text not intended for the counterparty
                self.reject(msg);
                return next_msg();
            } else if (result instanceof Msg) {
                self.send(result);
                return next_msg();
            }

            // next message handler
            next();
        });
    })();
};

Session.prototype._process_incoming = function(msg, cb) {
    var self = this;

    self.last_timestamp = Date.now();

    // first message should always be a logon
    if (!self.is_logged_in && msg.MsgType !== 'A') {
        return cb(new RejectWithText('expected Logon message, got: ' + msg.MsgType, Fields.MsgType));
    }

    // check sequence gap
    var msg_seq_num = +msg.MsgSeqNum;

    if (isNaN(msg_seq_num)) {
        return cb(new RejectWithText('MsgSeqNum must be numeric: ' + msg.MsgSeqNum, Fields.MsgSeqNum));
    }

    // SeqReset - Reset ignores message sequencing
    // this will be handled by the session admin
    if (msg.MsgType === '4' && (msg.GapFillFlag === undefined || msg.GapFillFlag === 'N')) {
        return cb();
    }

    if (msg_seq_num > self.incoming_seq_num) {
        // clear incoming message queue for new messages from resend request
        // TODO hang on to these messages?
        self.msg_queue = [];

        // request resend
        var resend_request = new Msgs.ResendRequest();
        resend_request.BeginSeqNo = self.incomingSeqNum;
        resend_request.EndSeqNo = 0;
        return cb(resend_request);
    } else if (msg_seq_num < self.incoming_seq_num) {
        // From the fix spec:
        // If the incoming message has a sequence number less than expected and the
        // PossDupFlag is not set, it indicates a serious error. It is strongly
        // recommended that the session be terminated and manual intervention be initiated.

        // TODO our callback mechanism needs a way to drop messages to the floor
        // no reject, no send, no further processing
        //if (msg.PossDupFlag === 'Y') {
            // ignore
            //return; // we can't do this, no other handlers will be called ever again
        //}

        cb(new RejectWithText('sequence reversal; expecting ' + self.incoming_seq_num + ' got ' + msg_seq_num + '. terminating session', Fields.MsgSeqNum));
        return self.end();
    }

    // set new expected seq
    self.incoming_seq_num = msg_seq_num + 1;

    // message has passed basic tests, send to next level
    // app then our admin handler
    cb();
};

// send a message to the session
Session.prototype.send = function(msg, keep_set_fields) {
    var self = this;

    // set session specific headers
    msg.SenderCompID = self.sender_comp_id;
    msg.TargetCompID = self.target_comp_id;

    if (!keep_set_fields || msg.SendingTime === undefined) {
        msg.SendingTime = new Date();
    }

    self.last_outgoing_time = new Date().getTime();

    // increment the next outgoing
    msg.MsgSeqNum = self.outgoing_seq_num++;

    self.emit('send', msg);
};

/// logon to a client session
/// 'logon' event fired when session is active
Session.prototype.logon = function(additional_fields) {
    var self = this;
    var msg = new Msgs.Logon();
    msg.HeartBtInt = 10;
    msg.EncryptMethod = 0;

    if (additional_fields) {
        var ids = Object.keys(additional_fields);
        ids.forEach(function(id) {
            msg.set(id, additional_fields[id]);
        });
    }

    self.send(msg);
};

/// initiate a logout sequence and subsequently end a session
Session.prototype.logout = function(reason) {
    var self = this;
    var msg = new Msgs.Logout();
    if (reason) {
        msg.Text = reason;
    }
    self.send(msg);

    // if counter party was logged in, wait for their confirmation
    if (self.is_logged_in) {
        // if no confirmation after some interval, force session done
        self.logout_confirmation = setTimeout(function() {
            self.end();
        }, 1000 * 30);
    }
};

/// terminate the session
Session.prototype.end = function() {
    var self = this;

    // if there was an active session, terminate it
    // logout should have done this for a clean shutdown
    self.is_logged_in = false;

    self.emit('end');
    self.removeAllListeners('end'); // avoid duplicate 'end' events
};

module.exports = Session;
