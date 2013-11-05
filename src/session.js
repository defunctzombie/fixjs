/// fix session

var events = require('events');

var Msg = require('./msg');
var Msgs = require('./msgs');

var middleware = function() {
    var content = [];

    // this will be called with args to apply to all content items
    var process = function() {
        if (arguments.length > 2) {
            return process_2arg.apply(null, arguments);
        }
        return process_1arg.apply(null, arguments);
    };

    var process_1arg = function(msg, done_fn) {
        var idx = 0;
        (function next(err) {
            if (err) {
                return done_fn(err);
            }

            if (idx >= content.length) {
                return done_fn();
            }

            content[idx++](msg, next);
        })();
    };

    var process_2arg = function(error, msg, done_fn) {
        var idx = 0;
        (function next(err) {
            if (err) {
                return done_fn(err);
            }

            if (idx >= content.length) {
                return done_fn();
            }

            content[idx++](error, msg, next);
        })();
    };

    process.push = content.push.bind(content);
    return process;
};

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

    self._pipeline = middleware();
    self._error_pipeline = middleware();

    // admin handlers
    var admin = self.admin = {};

    admin.Logon = function(msg, next) {
        var heartbt_milli = +msg.HeartBtInt * 1000;
        if (isNaN(heartbt_milli)) {
            return self.reject(msg, 'invalid heartbeat internval, must be numeric');
            // send back invalid heartbeat
            return next(new Error('invalid heartbeat interval, must be numeric'));
        };

        // heatbeat handler
        var heartbeat_timer = setInterval(function () {
            var currentTime = new Date();

            // counter party might be dead, kill connection
            if (currentTime - self.last_incomin_time > heartbt_milli * 2 && self.expectHeartbeats) {
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
        self.send(heartbeat);
        return next();
    };

    admin.ResendRequest = function(msg, next) {
        // TODO, currently just sends a sequence reset
        var seq_reset = new Msgs.SequenceReset();
        seq_reset.GapFillFlag = 'N';
        seq_reset.NewSeqNo = msg.EndSeqNo;
        self.send(seq_reset);
        return next();
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
            return next(new Error('SequenceReset may not decrement sequence numbers'));
        }

        self.incoming_seq_num = reset_num;
        next();
    };

    admin.Heartbeat = function(msg, next) {
        next();
    };

    admin.Reject = function(msg, next) {
        next();
    };

    // admin handler
    self.use(function(msg, next) {
        self._process_incoming(msg, next);
    });

    // fanout
    self.use(function(msg, next) {
        var listeners = self.listeners(msg.name).concat();
        if (listeners.length === 0) {
            // admin messages don't need to be handled by the app
            // reject messages are specially handled to emit errors
            if (['0', '1', '2', '4', '5', 'A'].indexOf(msg.MsgType) >= 0) {
                return next();
            }

            if (msg.MsgType === '3') {
                self.emit('error', new Error('Reject messages should be handled'));
                return next();
            }

            // we reject to let the sender know we don't care about this message
            var reject = Msgs.Reject();
            reject.Text = 'unsupported message type: ' + msg.MsgType;
            reject.SessionRejectReason = 11; // invalid MsgType
            return next(reject);
        }

        (function next_listener() {
            var handler = listeners.shift();
            if (!handler) {
                return next();
            }

            handler(msg, function(result) {
                if (result) {
                    return next(result);
                }

                // next message handler
                next_listener();
            });
        })();
    });
};

Session.prototype = new events.EventEmitter();

Session.prototype.use = function(fn) {
    if (fn.length === 3) {
        this._error_pipeline.push(fn);
        return this;
    }

    this._pipeline.push(fn);
    return this;
};

Session.prototype.reject = function(orig_msg, reject) {
    var self = this;

    if (typeof reject === 'string') {
        var msg = new Msgs.Reject();
        msg.Text = reject;
        reject = msg;
    }

    reject.RefSeqNum = orig_msg.MsgSeqNum;
    reject.RefMsgType = orig_msg.MsgType;
    return self.send(reject);
};

// process incoming message
Session.prototype.incoming = function(msg) {
    var self = this;

    // messages need to be processes in the order in which they are received
    // it would be wrong to receive order A then order B and for some reason
    // send order B to the matching engine before order A
    if (self.processing) {
        return self.msg_queue.push(msg);
    }

    self.processing = true;

    function next_msg() {
        self.processing = false;
        var msg = self.msg_queue.shift();
        if (!msg) {
            return;
        }
        return self.incoming(msg);
    }

    // checks that the handler actually returned in a reasonable amount of time
    // TODO let user specify what to do in this case? skip to next message?
    // this would be bad as we did not fully process this message but did mark expected sequence numbers
    // maybe mark sequence number after message is done processing? I kinda like that more
    var execution_timeout = setTimeout(function() {
        var err = new Error('message handler taking too long to execute');
        err.msg = msg;
        self.emit('error', err);
    }, 1000);

    function handle_err(err, cb) {
        // TODO (shtylman) if a logon message, session will be ended
        // no more messages will be processed
        if (msg.MsgType === 'A') {
            self.msg_queue = []
            cb();

            // TODO (shtylman) should send back reason user will be disconnected
            return self.logout(err.message);
        }

        // TODO I think the error pipeline should just take over?
        if (err instanceof Msg) {
            return self.send(err);
        }

        self._error_pipeline(err, msg, function(err) {
            if (err) {
                if (err instanceof Msg) {
                    return self.send(err);
                }

                self.emit('error', err);
            }

            cb();
        });
    }

    // start the message down the pipeline
    self._pipeline(msg, function(err) {
        clearTimeout(execution_timeout);

        // called when pipeline is done
        if (err) {
            return handle_err(err, next_msg);
        }

        // admin handlers run after other pipeline parts?
        var admin_handler = self.admin[msg.name];
        if (!admin_handler) {
            return next_msg();
        }
        admin_handler(msg, function(err) {
            if (err) {
                return handle_err(err);
            }

            return next_msg();
        });
    });
};

Session.prototype._process_incoming = function(msg, next) {
    var self = this;

    self.last_timestamp = Date.now();

    // first message should always be a logon
    if (!self.is_logged_in && msg.MsgType !== 'A') {
        return next(new Error('expected Logon message, got: ' + msg.MsgType));
    }

    // check sequence gap
    var msg_seq_num = +msg.MsgSeqNum;

    if (isNaN(msg_seq_num)) {
        return next(new Error('MsgSeqNum must be numeric: ' + msg.MsgSeqNum));
    }

    // SeqReset - Reset ignores message sequencing
    // this will be handled by the session admin
    if (msg.MsgType === '4' && (msg.GapFillFlag === undefined || msg.GapFillFlag === 'N')) {
        return next();
    }

    if (msg_seq_num > self.incoming_seq_num) {
        // clear incoming message queue for new messages from resend request
        // TODO hang on to these messages?
        self.msg_queue = [];

        // request resend
        var resend_request = new Msgs.ResendRequest();
        resend_request.BeginSeqNo = self.incomingSeqNum;
        resend_request.EndSeqNo = 0;
        self.send(resend_request);
        return next();
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

        next(new Error('sequence reversal; expecting ' + self.incoming_seq_num + ' got ' + msg_seq_num + '. terminating session'));
        return self.end();
    }

    // set new expected seq
    self.incoming_seq_num = msg_seq_num + 1;

    next();
};

// send a message to the session
Session.prototype.send = function(msg) {
    var self = this;

    // set session specific headers
    msg.SenderCompID = self.sender_comp_id;
    msg.TargetCompID = self.target_comp_id;
    msg.SendingTime = new Date();

    self.timeOfLastOutgoing = new Date().getTime();

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
    msg.Text = reason;
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
};

module.exports = Session;
