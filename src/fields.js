// builtin
var fs = require('fs');
var path = require('path');
// 3rd party
var xml2js = require('xml2js');

// load resource file
var data = fs.readFileSync(path.join(__dirname, '..','resources','FIX42.xml'));

var parser = new xml2js.Parser();
parser.parseString(data, function (err, result) {
    result.fields.field.forEach(function(field) {
        var number = field['@'].number;
        var name = field['@'].name;

        module.exports[name] = {
            tag: number,
        };
    });
});
