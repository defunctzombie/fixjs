"use strict";

var util = require('util');

// custom Error class whose text is meant to be sent in a Reject message
// field is optional; if specified it will be sent as RefTagID
function RejectWithText(text, field) {
    this.name = this.constructor.name;
    this.message = text;
    this.field = field;
}

util.inherits(RejectWithText, Error);

module.exports.RejectWithText = RejectWithText;
