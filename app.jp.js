const MatApplication = require("./MatApplication");
matApp = new MatApplication("test", "0.0.0.0", 2000, "/hook",
    "iDa61cZrFsroyKeNlPPEmMVYkgEB5uKXYucfBTcVNMZuryKHi4a5jV8E8PekLgJl",
    "h50UeRICqOIMGIk4Vq6Ugyf2RIo8qXjPlJEDpbhcrusF5ClN6qtnyAykAlCsLgJY", 200, 300);

matApp.registerMatFunction(["test.function"], (event)=>{
    console.log("event accepted");
});

matApp.start();