
class MatApplication{

    constructor(applicationName, ip, port, hookAddress, publicKey, secretKey, threadPool, timeout) {
        this.applicationName = applicationName
        this.ip = ip
        this.hookAddress = hookAddress
        this.publicKey = publicKey
        this.secretKey = secretKey
        this.threadPool = threadPool
        this.timeout = timeout
    }
}

module.exports = MatApplication;