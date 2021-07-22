let express = require("express");
let route = express();
let bodyParser = require('body-parser');

const crypto = require('crypto');

class MatApplication{

    constructor(applicationName, ip, port, hookAddress, publicKey, secretKey, threadPool, timeout) {
        this.applicationName = applicationName;
        this.ip = ip;
        this.port = port;
        this.hookAddress = hookAddress;
        this.publicKey = publicKey;
        this.secretKey = secretKey;
        this.threadPool = threadPool;
        this.timeout = timeout;

        this.functionInformation = {};
        this.listeningEvents = {};
        this.__registerListener();

        this.waitingForResponse = [];
        this.responseTable = {};

    }
    //mat function decorator
    registerMatFunction(listeningEvents, callback, returnResponse, acceptOnlyWithResponseId, name, description, output, params){
        for(const eventName of listeningEvents){
            if(!(eventName in Object.keys(this.listeningEvents))){
                this.listeningEvents[eventName] = []
            }
            if(returnResponse !== undefined){
                returnResponse = false;
            }
            if(acceptOnlyWithResponseId !== undefined){
                acceptOnlyWithResponseId = false;
            }
            this.listeningEvents[eventName].push({
                "function": callback,
                "returnResponse": returnResponse,
                "acceptOnlyWithResponseId": acceptOnlyWithResponseId
            });
        }

        if(name !== undefined){
            this.functionInformation[this.applicationName + "." + name] = {
                "description": description,
                "output": output,
                "params": params
            }
        }
    }


    __registerListener(){
        route.use(bodyParser.json());
        route.post(this.hookAddress, (req, res)=>{
            if(req.body === null || !("name" in req.body)){
                res.status(400);
                res.send("");
                return;
            }
            if(this.__verify_message(req.body, this.secretKey) === req.headers.v){
                this.__handle_event(req.body);
                res.send("");
                return;
            }
            res.status(400);
            res.send("");
        })
    }

    __handle_event(event){
        if("responseId" in event && event["responseId"] in this.waitingForResponse){
            this.responseTable[event["responseId"]] = event;
        }
        for(const eventName of Object.keys(this.listeningEvents)){
            if(eventName === event["name"] ||
                (eventName.includes("*") && event["name"].startsWith(eventName.replaceAll("*", "")))){
                this.__execute_event(eventName, event);
            }
        }
    }

    __execute_event(registeredEventName, event){
        if(!(registeredEventName in this.listeningEvents)){
            return;
        }
        for(const functionInfo of this.listeningEvents[registeredEventName]){

            if(functionInfo["acceptOnlyWithResponseId"] && !("responseId" in event)){
                return;
            }
            const result = functionInfo["function"](event);
            console.log(result);

        }
    }

    __verify_message(payload, secret){
        return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(payload)).toString("base64") + "." + secret, 'utf8').digest('hex');
    }

    start(){
        route.listen(this.port);
    }

}

module.exports = MatApplication;