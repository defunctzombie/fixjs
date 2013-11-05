/// fix server which will fill every new order request

var fix = require('../fix');

var server = fix.createServer({}, function(session) {

    var order_id = 0;

    session.on('NewOrderSingle', function(msg) {
        var execution = new Msgs.ExecutionReport();
        execution.

            //send fill
            execution.OrderID = ++order_id;
            var orderID = orderIDs++;
            var clOrdID = msg['11'];
            var execID = execIDs++;
            var execTransType = '0'; //new
            var execType = '2';//fill
            var ordStatus = '2'; //filled
            var symbol = msg['55'];
            var side = msg['54'];
            var qty = msg['38'];
            var leaves = 0;
            var cumQty = qty;
            var avgpx = 100; //if there is limit price, this will be overwritten by limit
            var lastpx = 100; //if there is limit price, this will be overwritten by limit
            var lastshares = qty;
        session.send(execution);
    });
});
