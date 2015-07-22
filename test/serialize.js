var after = require('after');
var assert = require('assert');
var Msgs = require('../src/Msgs');

suite('serialization');

test('should not have null byte if no body', function() {
    var msg = new Msgs.Logout();

    var out = msg.serialize();

    var expected = [
        '8=FIX.4.2',
        '9=57',
        '35=5',
        '52=undefined',
        '49=undefined',
        '56=undefined',
        '34=undefined',
        '10=067',
        ''
    ];

    var actual = Buffer(out).toString().split('\u0001');
    assert.deepEqual(actual, expected);
});

