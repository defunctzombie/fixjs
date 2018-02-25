var path = require('path');
var after = require('after');
var assert = require('assert');
var FrameDecoder = require(path.join(__dirname, '..','src','frame_decoder'));

var sep = String.fromCharCode(1);

suite('frame decoder');

test('decode', function(done) {

    var decoder = FrameDecoder();
    decoder.on('data', function(msg) {
        done();
    });

    // feed full frame
    var data = ['8=', 'FIX.4.2', sep, '9=', '5', sep, '35=0', sep, '10=161', sep];
    decoder.write(data.join(''));
});

test('incremental decode', function(done) {
    var decoder = FrameDecoder();
    decoder.on('data', function(msg) {
        done();
    });

    // feed data in parts to test incremental parsing
    var data = ['8=', 'FIX.4.2', sep, '9=', '5', sep, '35=0', sep, '10=161', sep];
    data.forEach(decoder.write.bind(decoder));
});

test('decode multiple', function(done) {
    var decoder = FrameDecoder();

    done = after(2, done);
    decoder.on('data', function(msg) {
        done();
    });

    // feed data in parts to test incremental parsing
    var data = ['8=', 'FIX.4.2', sep, '9=', '5', sep, '35=0', sep, '10=161', sep];
    data.forEach(decoder.write.bind(decoder));
    data.forEach(decoder.write.bind(decoder));
});

test('decode wiki example', function(done) {
    var decoder = FrameDecoder();

    done = after(2, done);
    decoder.on('data', function(msg) {
        done();
    });

    // example messages from wikipedia page
    // http://en.wikipedia.org/wiki/Financial_Information_eXchange
    var msg = '8=FIX.4.2|9=178|35=8|49=PHLX|56=PERS|52=20071123-05:30:00.000|11=ATOMNOCCC9990900|20=3|150=E|39=E|55=MSFT|167=CS|54=1|38=15|40=2|44=15|58=PHLX EQUITY TESTING|59=0|47=C|32=0|31=0|151=15|14=0|6=0|10=128|';

    decoder.write(msg.replace(/\|/g, sep));
    var msg = '8=FIX.4.2|9=65|35=A|49=SERVER|56=CLIENT|34=177|52=20090107-18:15:16|98=0|108=30|10=062|';

    decoder.write(msg.replace(/\|/g, sep));
});

/** Test for issue fixed in commit:
 *  https://github.com/defunctzombie/fixjs/commit/5010c720b1f3a8d71c5cda80945aa7c0bf1ba882
 *  That prevented multiple callbacks when buffer fills up
 */
test('Filled up buffer', function(done) {
    var decoder = FrameDecoder();
    var repeat = function (string, num) {
        return new Array(num + 1).join(string);
    };
    var num = 1000;
    done = after(30, done);
    decoder.on('data', function(msg) {
        done();
    });

    // example messages from wikipedia page
    // http://en.wikipedia.org/wiki/Financial_Information_eXchange
    var msg = '8=FIX.4.2|9=178|35=8|49=PHLX|56=PERS|52=20071123-05:30:00.000|11=ATOMNOCCC9990900|20=3|150=E|39=E|55=MSFT|167=CS|54=1|38=15|40=2|44=15|58=PHLX EQUITY TESTING|59=0|47=C|32=0|31=0|151=15|14=0|6=0|10=128|';
    var messages = repeat(msg,num);
    decoder.write(messages.replace(/\|/g, sep));

});

test('invalid metadata', function(done) {
    var examples = {
        'Invalid CheckSum: ': ['8=', 'FIX.4.2', sep, '9=', '5', sep, '35=0', sep, '10=162', sep],
        'Invalid BeginString: ': ['8=', 'FiX.4.2', sep, '9=', '5', sep, '35=0', sep, '10=161', sep],
        'Invalid BodyLength: ': ['8=', 'FIX.4.2', sep, '9=', '50000', sep, '35=0', sep, '10=161', sep],
    };

    done = after(Object.keys(examples).length, done);

    for (var err_message in examples) {
        var decoder = FrameDecoder();
        decoder.on('data', function(msg) {
            assert(false);
        });

        try {
            decoder.write(examples[err_message].join(''));
        } catch (err) {
            assert(err.message.indexOf(err_message) === 0, err);
            done();
        }
    }
});
