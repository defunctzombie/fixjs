/// fix message

var moment = require('moment');

// convert a date object into a fix formatted timestamp
var getUTCTimeStamp = function(date){
    return moment(date).utc().format('YYYYMMDD-HH:mm:ss.SSS');
}

var Msg = function() {
    var self = this;

    // map of field number (as a string) to field value
    self._fields = {};

    self._define_field = function(field_id, name, opt) {
        var validator = (opt && opt.validator) ? opt.validator : function(v) { return v; };
        Object.defineProperty(self, name, {
            get: function() {
                return self.get(field_id);
            },
            set: function(value) {
                self.set(field_id, validator(value));
            }
        });
    };

    self._define_field('49', 'SenderCompID');
    self._define_field('56', 'TargetCompID');
    self._define_field('50', 'SenderSubID');
    self._define_field('35', 'MsgType');
    self._define_field('34', 'MsgSeqNum');
    self._define_field('52', 'SendingTime', {
        validator: function(value) {
            if (value instanceof Date) {
                return getUTCTimeStamp(value);
            }
            return value;
        }
    });
};

// constants
Msg.kFieldSeparator = String.fromCharCode(1);

Msg.prototype.get = function(field_id) {
    var self = this;
    return self._fields[field_id];
};

Msg.prototype.set = function(field_id, value) {
    var self = this;
    self._fields[field_id] = value;
}

Msg.prototype.serialize = function() {
    var self = this;

    var header_arr = [];
    var body_arr = [];

    var fields = self._fields;

    header_arr.push('35=' + self.MsgType);
    header_arr.push('52=' + self.SendingTime);
    header_arr.push('49=' + self.SenderCompID);
    header_arr.push('56=' + self.TargetCompID);
    header_arr.push('34=' + self.MsgSeqNum);

    // manually inserted
    var ignore = ['8', '9', '35', '10', '52', '49', '56', '34'];

    for (var tag in fields) {
        if (fields.hasOwnProperty(tag) && ignore.indexOf(tag) === -1) {
            body_arr.push(tag + '=' + fields[tag]);
        }
    }

    var headermsg = header_arr.join(Msg.kFieldSeparator);
    var bodymsg = body_arr.join(Msg.kFieldSeparator);

    var out = [];
    out.push('8=' + 'FIX.4.2'); // TODO variable
    out.push('9=' + (headermsg.length + bodymsg.length + 2)); // +2 for separators we will add
    out.push(headermsg);
    out.push(bodymsg);

    var outmsg = out.join(Msg.kFieldSeparator);
    outmsg += Msg.kFieldSeparator;
    return outmsg + '10=' + Msg.checksum(outmsg) + Msg.kFieldSeparator;
};

Msg.checksum = function(str) {
    var chksm = 0;
    for (var i = 0; i < str.length; ++i) {
        chksm += str.charCodeAt(i);
    }

    chksm = chksm % 256;

    var checksumstr = '';
    if (chksm < 10) {
        checksumstr = '00' + (chksm + '');
    } else if (chksm >= 10 && chksm < 100) {
        checksumstr = '0' + (chksm + '');
    } else {
        checksumstr = '' + (chksm + '');
    }

    return checksumstr;
};

Msg.parse = function(raw) {
    var Msgs = require('./msgs');

    var fix = {};
    var keyvals = raw.split(Msg.kFieldSeparator);

    keyvals.forEach(function(kv) {
        if (kv.length === 0) {
            return;
        }

        // a field could have an = in it, don't see why not
        var components = kv.split('=');
        var id = components.shift();
        fix[id] = components.join('=');
    });

    // TODO validate header
    var type = fix['35'];
    if (!type) {
        throw new Error('no MsgType in fix message');
    }

    var msg_t = Msgs.types[type];
    if (!msg_t) {
        throw new Error('no such message type: ' + type);
    }

    var msg = new msg_t();
    msg._fields = fix;
    return msg;
};

module.exports = Msg;

