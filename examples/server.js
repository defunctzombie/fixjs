/// fix server which will fill every new order request

var fix = require('../fix');

var server = fix.createServer({}, function(session) {

    // session has logged on
    session.on('logon', function() {
    });

    // session has logged off
    session.on('logoff', function() {
    });

    // called for every incoming message
    // calling next(new Error) will send a reject back to the counter party
    // specifying a RefTagID field for the error will indicate a reference tag
    session.on('message', function(msg, next) {
        console.log(msg);
        next();
    });

    // allows you to intercept a message before it is sent out
    // the session has populated the message fully, but you can still make changes
    // calling next(new Error) will cancel the sending the message
    // you MUST call next otherwise messages will stop processing
    session.on('send', function(msg, next) {
        next();
    });

    // specific FIX messages can be bound as events
    // the next argument has the same behavior as with 'message'
    // any app messages you do not handle will be rejected as unsupported messages
    // admin messages are handled for you by the session
    // if you want to send a response back to the user
    // you can just call next(fix message) and it will be sent
    session.on('NewOrderSingle', function(msg, next) {
        next(...);
    });

    // additional auth for the logon message can be done here
    session.on('Logon', function(msg, next) {
        next();
    });
});
