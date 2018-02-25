const path = require('path');
var through = require('through2');

var Msg = require(path.join(__dirname, 'msg'));

var kFieldSeparator = Msg.kFieldSeparator;

// length of first field, it is always 8=FIX.#.#<SOH>
var kFirstFieldLen = 10;
var kChecksumFieldLen = 7;

module.exports = function() {
    var buffer = '';

    var stream = through.obj(function(chunk, enc, cb) {
        var self = this;
        buffer += chunk;

        while (buffer.length > 0) {
            // Step 1: Extract complete FIX message
            // If we don't have enough data to start extracting body length, wait for more data
            if (buffer.length < kFirstFieldLen + 14) {
                return cb();
            }

            if (buffer.slice(0, 6) !== '8=FIX.' || buffer[7] !== '.' || buffer[9] !== kFieldSeparator) {
                var err = 'Invalid BeginString: ' + buffer.slice(0, kFirstFieldLen);
                return cb(new Error(err));
            }

            // look for a field separator after the one after 8=FIX.#.#<SOH>
            var endTag9 = buffer.indexOf(kFieldSeparator, kFirstFieldLen);

            // don't have all of tag 9 yet
            if (endTag9 < 0) {

                // if we have seen 8=FIX.#.#|9=####? and have no end tag 9
                // then the message is not valid
                // tag 9 can only have values 0-9999
                if (buffer.length > 17) {
                    var err = 'no valid BodyLength tag found in header: ' + buffer;
                    return cb(new Error(err));
                }

                return cb();
            }

            if (buffer.slice(kFirstFieldLen, kFirstFieldLen + 2) !== '9=') {
                var err = 'Invalid BodyLength: ' + buffer.slice(kFirstFieldLen, endTag9);
                return cb(new Error(err));
            }

            // get field separator after tag9
            // if unable to get end of tag 9, we haven't received a full message yet
            // +2 for '9='
            var body_len_str = buffer.slice(kFirstFieldLen + 2, endTag9);
            var body_len = body_len_str - 0;

            // as parsed above, BodyLength (tag 9) has a limit of 9999 (could be increased)
            if (isNaN(body_len) || body_len < 0 || body_len > 9999) {
                var err = 'Invalid BodyLength: ' + body_len_str;
                return cb(new Error(err));
            }

            // make sure to include checksum field and trailing separator
            // so we can properly slice away this message from the buffer
            // endTag9 +1 for <SOH> after tag 9
            var msg_len = body_len + endTag9 + 1 + kChecksumFieldLen;

            // don't have full message yet
            if (buffer.length < msg_len) {
                return cb();
            }

            var msg = buffer.slice(0, msg_len);

            // buffer is what remains after current message is removed
            buffer = buffer.slice(msg_len);

            // get just message body without checksum field
            var msg_body = msg.slice(0, msg.length - kChecksumFieldLen);

            var expected_checksum = Msg.checksum(msg_body);
            var actual_checksum = msg.substr(msg.length - 4, 3);

            if (expected_checksum !== actual_checksum) {
                var err = 'Invalid CheckSum: ' + msg;
                return cb(new Error(err));
            }

            // load up proper message type
            self.push(Msg.parse(msg));
        }

        cb();
    });

    return stream;
}

