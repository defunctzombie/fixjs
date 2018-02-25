
// builtin
const path = require('path');
var fs = require('fs');
var util = require('util');

// 3rd party
var xml2js = require('xml2js');

var Msg = require(path.join(__dirname, 'msg'));

// message type -> message constructor
module.exports.types = {}

// load resource file
var data = fs.readFileSync(path.join(__dirname, '..','resources','FIX42.xml'));

var parser = new xml2js.Parser();
parser.parseString(data, function (err, result) {
    // map of field name to number
    var field_map = {
    };

    // map of number to id
    var rev_field_map = {
    };

    result.fields.field.forEach(function(field) {
        var number = field['@'].number;
        var name = field['@'].name;

        field_map[name] = number;
        rev_field_map[number] = name;
    });

    result.messages.message.forEach(function(message) {
        var name = message['@'].name;
        var type = message['@'].msgtype;

        var field_properties = [];

        // new message class
        var msg_t = function() {
            var self = this;
            Msg.call(self);

            self.MsgType = type;
            self.name = name;

            field_properties.forEach(function(prop) {
                var name = prop.name;
                var id = prop.id;
                Object.defineProperty(self, name, {
                    get: function() {
                        return self.get(id);
                    },
                    set: function(value) {
                        self.set(id, value);
                    },
                });
            });
        };

        msg_t.prototype = new Msg();

        msg_t.prototype.toString = function() {
            var self = this;
            var res = '';

            // this handles printing custom fields which we don't know the name of
            var fields = Object.keys(self._fields);
            fields.forEach(function(field_id) {
                var val = self.get(field_id);
                var name = field_id;
                if (rev_field_map[field_id]) {
                    name = rev_field_map[field_id];
                }
                res += name + '=' + val + ' ';
            });
            return res;
        };

        if (!(message.field instanceof Array)) {
            message.field = [message.field];
        }

        message.field.forEach(function(field) {
            var field_name = field['@'].name;
            var field_id = field_map[field_name];
            if (!field_id) {
                return;
            }

            field_properties.push({
                name: field_name,
                id: field_id,
            });
        });

        module.exports[name] = msg_t;
        module.exports.types[type] = msg_t;
    });
});
