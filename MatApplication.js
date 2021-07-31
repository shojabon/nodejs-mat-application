let express = require("express");
let route = express();
let bodyParser = require('body-parser');
const axios = require('axios');

const crypto = require('crypto');

class MatEventObject{

    constructor(name, params={}, exception=true, options={}) {
        this.name = name;
        this.params = params;
        this.exception = exception;

        this.target = options["target"];
        this.responseId = options["responseId"];
        this.response = options["response"];
    }

    data(){
        let target = {
            "name": this.name,
            "params": this.params,
            "exception": this.exception
        }
        if(this.responseId !== undefined){
            target["responseId"] = this.responseId;
        }
        if(this.response === true){
            target["response"] = this.response;
        }
        if(this.target !== undefined){
            target["target"] = this.target;
        }
        return target;
    }
}

class MatApplication{

    constructor(applicationName, ip, port, hookAddress, publicKey, secretKey, timeout) {
        this.applicationName = applicationName;
        this.ip = ip;
        this.port = port;
        this.hookAddress = hookAddress;
        this.publicKey = publicKey;
        this.secretKey = secretKey;
        this.timeout = timeout;

        this.functionInformation = {};
        this.listeningEvents = {};
        this.__registerListener();

        this.waitingForResponse = [];
        this.responseTable = {};

        this.eventHandlerEndpoints = [];

    }
    //mat function decorator
    registerMatFunction(listeningEvents, callback, returnResponse, acceptOnlyWithResponseId, functionInformation ={}){
        for(const eventName of listeningEvents){
            if(!(eventName in Object.keys(this.listeningEvents))){
                this.listeningEvents[eventName] = []
            }
            if(returnResponse === undefined){
                returnResponse = false;
            }
            if(acceptOnlyWithResponseId === undefined){
                acceptOnlyWithResponseId = false;
            }
            this.listeningEvents[eventName].push({
                "function": callback,
                "returnResponse": returnResponse,
                "acceptOnlyWithResponseId": acceptOnlyWithResponseId
            });
        }

        if(functionInformation["name"] !== undefined){
            this.functionInformation[this.applicationName + "." + functionInformation["name"]] = functionInformation;
        }
    }

    registerEndpoint(endpoint){
        this.eventHandlerEndpoints.push(endpoint);
    }

    //======== BASE FUNCTIONS ====
    async getNetworkSubscribers(){
        for(const endpoint of this.eventHandlerEndpoints){
            const result = await this.__executeBaseFunction(new MatEventObject("application.subscriber.list", {}).data(), this.publicKey, this.secretKey, endpoint);
            if(result["name"] === "success"){
                return result["params"];
            }
            if(result["exception"] && result["name"] !== "endpoint.error"){
                return null;
            }
        }
        return null;
    }
    //======== SEND FUNCTIONS ====

    async sendEventMultiple(events = []){
        for(let index = 0; index < events.length; index++){
            events[index] = this.sendEvent(events[index]);
        }
        return await Promise.all(events);
    }

    async sendEventApplicationSubscribers(event){
        const applicationNames = Object.keys(await this.getNetworkSubscribers());
        let events = [];
        for(const appName of applicationNames){
            let eventCopy = Object.assign(Object.create(Object.getPrototypeOf(event)), event);
            eventCopy["target"] = appName;
            events.push(eventCopy);
        }
        const tempResult = await this.sendEventMultiple(events);
        let output = {};
        for(let i = 0; i < applicationNames.length; i++){
            output[applicationNames[i]] = tempResult[i];
        }
        return output;
    }

    async sendEvent(event){
        if(!(event instanceof MatEventObject)){
            return new MatEventObject("event.invalid", {}, true).data();
        }
        if(this.eventHandlerEndpoints.length === 0){
            return new MatEventObject("endpoint.invalid", {}, true).data();
        }

        for(const endpoint of this.eventHandlerEndpoints){
            try{
                const data = Object.assign({}, event.data());
                data["publicKey"] = this.publicKey;
                const responseData = await this.__restPostToAddress(endpoint, this.secretKey, data);
                if(responseData["exception"]){
                    if(responseData["name"] === "target.invalid"){
                        return responseData;
                    }
                    continue;
                }

                if("responseId" in responseData["params"]){
                    const responseId = responseData["params"]["responseId"];
                    this.waitingForResponse.push(responseId);
                    await this.__waitUntil(()=>{return responseId in this.responseTable}, this.timeout, 50);
                    this.waitingForResponse.splice(this.waitingForResponse.indexOf(responseId), 1);
                    if(responseId in this.responseTable){
                        const eventData = this.responseTable[responseId];

                        delete this.responseTable[responseId];

                        delete eventData["responseId"];
                        return eventData;
                    }else{
                        return new MatEventObject("response.timeout", {}, true).data();
                    }
                }
                return responseData
            }catch (ex){
            }
        }

        return new MatEventObject("endpoint.failed", {}, true).data();
    }

    //======== HIDDEN ============

    __registerFunctionInformation(){
        for(const endpoint of this.eventHandlerEndpoints){
            this.__executeBaseFunction(new MatEventObject("application.function.register", this.functionInformation).data(), this.publicKey, this.secretKey, endpoint).then((result)=>{console.log(result)});
        }
    }

    async __executeBaseFunction(payload, publicKey, secretKey, eventBusEndpoint){
        payload["publicKey"] = publicKey;
        return this.__restPostToAddress(eventBusEndpoint + "/base", secretKey, payload);
    }

    __registerListener(){
        route.use(bodyParser.json());
        route.post(this.hookAddress, (req, res)=>{
            if(req.body === null || !("name" in req.body)){
                res.status(400);
                res.send("");
                return;
            }
            if(this.__verifyMessage(req.body, this.secretKey) === req.headers.v){
                this.__handleEvent(req.body);
                res.send("");
                return;
            }
            res.status(400);
            res.send("");
        })
    }

    async __waitUntil(condition, timeout, period){
        const mustend = Math.floor(new Date().getTime() / 1000) + timeout;
        while(Math.floor(new Date().getTime() / 1000) < mustend){
            if(condition()){return true}
            await new Promise(resolve => setTimeout(resolve, period));
        }
        return false;
    }

    __handleEvent(event){
        if("responseId" in event && this.waitingForResponse.includes(event["responseId"])){
            this.responseTable[event["responseId"]] = event;
            return;
        }
        for(const eventName of Object.keys(this.listeningEvents)){
            if(eventName === event["name"] ||
                (eventName.includes("*") && event["name"].startsWith(eventName.replace("*", "")))){
                this.__executeEvent(eventName, event).then();
            }
        }
    }

    async __restPostToAddress(url, secret, data){
        const dataCopy = Object.assign({}, data);
        try{
            const result = await axios.post(url, data, {headers: {'Content-Type': 'application/json',"v": this.__verifyMessage(dataCopy, secret)}});
            if(result.status !== 200){
                return null;
            }
            return result.data;
        }catch (error){
            return null;
        }
    }

    async __executeEvent(registeredEventName, event){
        if(!(registeredEventName in this.listeningEvents)){
            return;
        }
        for(const functionInfo of this.listeningEvents[registeredEventName]){

            if(functionInfo["acceptOnlyWithResponseId"] && !("responseId" in event)){
                return;
            }
            const result = await functionInfo["function"](event);
            if(functionInfo["returnResponse"]){
                if("responseId" in event){
                    if(result instanceof MatEventObject){
                        if(result.name === undefined){
                            result.name = "response." + String(event["name"]);
                        }
                        result.responseId = event["responseId"];
                        this.sendEvent(result).then();
                        return;
                    }
                }

                if(result instanceof Object){
                    this.sendEvent(new MatEventObject("response." + String(event["name"]), result, false, {"responseId": event["responseId"]})).then();
                    return;
                }

                if(result === undefined){
                    let resultObject = new MatEventObject("response.empty", {}, false)
                    resultObject.responseId = event["responseId"];
                    this.sendEvent(resultObject).then();
                    return;
                }

                let resultObject = new MatEventObject("response." + String(event["name"]), {"result": result}, false)
                resultObject.responseId = event["responseId"];
                this.sendEvent(resultObject).then();
                return;
            }

        }
    }

    __verifyMessage(payload, secret){
        return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(payload)).toString("base64") + "." + secret, 'utf8').digest('hex');
    }

    start(pushFunctions=false){
        if(pushFunctions){
            this.__registerFunctionInformation();
        }
        route.listen(this.port, this.ip);
    }

}

module.exports = {
    "MatApplication": MatApplication,
    "MatEventObject": MatEventObject
}
