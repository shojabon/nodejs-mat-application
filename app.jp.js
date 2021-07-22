const MatApplication = require("./MatApplication");
matApp = new MatApplication.MatApplication("test", "0.0.0.0", 2000, "/hook",
    "iDa61cZrFsroyKeNlPPEmMVYkgEB5uKXYucfBTcVNMZuryKHi4a5jV8E8PekLgJl",
    "h50UeRICqOIMGIk4Vq6Ugyf2RIo8qXjPlJEDpbhcrusF5ClN6qtnyAykAlCsLgJY", 200, 300);

matApp.registerMatFunction(["test.function"], (event)=>{
    console.log("event accepted");
}, true, true);

matApp.register_endpoint("http://127.0.0.1:80/event");
matApp.start();

async function test(){
    const result = await matApp.send_event(new MatApplication.MatEventObject("test.function", {"test": "a"}, false, true, undefined, undefined));
    console.log(result);
}

test().then();