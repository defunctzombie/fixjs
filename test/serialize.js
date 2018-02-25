var path = require('path');
var after = require('after');
var assert = require('assert');
var Msgs = require(path.join(__dirname, '..','src','msgs'));

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

test('should not pass undefined or null through', function() {
    var msg = new Msgs.NewOrderSingle();

    msg.OrderQty = undefined;
    msg.Price = null;

    var out = msg.serialize();

    var expected = [
        '8=FIX.4.2',
        '9=57',
        '35=D',
        '52=undefined',
        '49=undefined',
        '56=undefined',
        '34=undefined',
        '10=082',
	'',
    ];

    var actual = Buffer(out).toString().split('\u0001');
    assert.deepEqual(actual, expected);
});
