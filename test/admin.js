/// test admin commands

var assert = require('assert');
var after = require('after');
var through = require('through');
var duplexer = require('duplexer');

var fix = require('..');
var Msgs = fix.Msgs;

test('logon', function(done) {
    var self = this;

    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));

    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', done);
    session.logon();
});

test('logout', function(done) {
    var self = this;

    done = after(3, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));

    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        done();
        session.logout();
    });

    // when the server responds with a clean logout
    session.on('logout', done);

    // login to the server
    session.logon();
});

test('spoof', function(done) {

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    var stream_server2 = through();
    var stream_client2 = through();

    server.attach(duplexer(stream_client2, stream_server2));
    var client2 = fix.createClient(duplexer(stream_server2, stream_client2));

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {

        // try to open another connection with same session
        var session = client2.session('initiator', 'acceptor');

        // we expect to be disconnected by the server
        client2.stream.on('end', function() {
            done();
        });

        // trying to reuse a session on a different connection should boot us
        session.logon();
    });

    session.logon();
});

test('test request', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        var msg = new Msgs.TestRequest();
        msg.TestReqID = 1337;
        session.send(msg);
    });

    session.on('Heartbeat', function(msg, next) {
        assert.equal(1337, msg.TestReqID);
        next();
        done();
    });

    // login to the server
    session.logon();
});

test('reject logon', function(done) {

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', function() {
            test.false(); //invalid call specifically to fail test
        });

        session.on('Logon', function(msg, next) {
            next(new Error('testing login reject'));
        });
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        assert.ok(false); //invalid call specifically to fail test
    });

    // a bad login will just terminate the session
    session.on('end', function() {
        done();
    });

    // login to the server
    session.logon();

});

// send back Reject messages for unsupported message types
test('Reject for unsupported MsgType', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        session.send(new Msgs.NewOrderSingle());
    });

    // handle client reject
    session.on('Reject', function(msg, next) {
        assert.equal('unsupported message type: D', msg.Text);
        next();
        done();
    });

    // login to the server
    session.logon();
});

test('resend request', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        var resend = new Msgs.ResendRequest();
        resend.BeginSeqNo = '1';
        resend.EndSeqNo = '10';
        session.send(resend);
    });

    session.on('SequenceReset', function(msg, next) {
        assert.equal('10', msg.NewSeqNo);
        assert.equal('N', msg.GapFillFlag);
        next();
        done();
    });

    session.logon();
});

test('sequest reset', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer();
    server.attach(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done)

        session.on('Heartbeat', function(msg, next) {
            assert.equal('10', msg.MsgSeqNum);
            next();
            done();
        });
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        var reset = new Msgs.SequenceReset();
        reset.NewSeqNo = '10';
        reset.GapFillFlag = 'N';
        session.send(reset);

        session.outgoing_seq_num = 10;
        session.send(new Msgs.Heartbeat());
    });

    session.logon();
});

test('message handler timeout', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);

        session.on('Reject', function() {
            // do nothing to test timeout
        });

        session.on('error', function(err) {
            assert.equal('message handler taking too long to execute', err.message);
            done();
        });
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        // client sends a reject message to server
        var msg = new Msgs.Reject();
        msg.Text = 'required tag missing';
        session.send(msg);
    });

    // login to the server
    session.logon();
});

// client sending a reject message to the server
test('reject from client', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);

        session.on('Reject', function(msg, next) {
            assert.equal('required tag missing', msg.Text);
            next();
            done();
        });
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        var msg = Msgs.Reject();
        msg.Text = 'required tag missing';
        session.send(msg);
    });

    session.on('error', function(err) {
        assert.ifError(err);
    });

    // login to the server
    session.logon();
});

// client sending a reject message to the server
test('message processing error', function(done) {
    done = after(2, done);

    var stream_server = through();
    var stream_client = through();

    var server = fix.createServer(duplexer(stream_client, stream_server));
    var client = fix.createClient(duplexer(stream_server, stream_client));

    server.on('session', function(session) {
        session.on('logon', done);

        // need to be able to handle the raw error and possibly provide an alternate
        // reject method
        session.use(function(err, msg, next) {
            var status = err.statusCode || err.status || err.status_code || 500;
            assert.equal(status, 400);
            assert.equal(err.message, 'test bad request');
            done();

            // we don't pass the error along
            next();
        });

        session.on('NewOrderSingle', function(msg, next) {
            var err = new Error('test bad request');
            err.statusCode = 400;

            // reject messages for NewOrderSingle
            // need to use the ExecutionReport with ExecType = 8 (Rejected)
            return next(err);
        });
    });

    var session = client.session('initiator', 'acceptor');
    session.on('logon', function() {
        session.send(Msgs.NewOrderSingle());
    });

    session.on('Reject', function(msg, next) {
        assert.equal(msg.MsgType, '3');
        assert.equal(msg.Text, 'test bad request');
        next();
    });

    // login to the server
    session.logon();
});

// TODO reject loop
// we send something, client sends reject
// we don't handle reject we send reject back

