// Перетворює знімок MQTT на одну команду Ditto для всіх функціональних блоків.
function mapToDittoProtocolMsg(headers, textPayload, bytePayload, contentType) {
    var topic = headers["mqtt.topic"] || "";
    var match = /^pzks\/([A-Za-z0-9_-]+)\/telemetry$/.exec(topic);
    if (!match) {
        return null;
    }

    var raw = typeof textPayload === "string" && textPayload.length > 0
        ? textPayload : Ditto.arrayBufferToString(bytePayload);
    var message = JSON.parse(raw);
    var required = ["sh", "el", "hip", "kn", "hd", "tor", "i", "t", "v", "lim", "est", "seq", "ts"];
    for (var index = 0; index < required.length; index++) {
        var field = required[index];
        if (message === null || message[field] === undefined || message[field] === null) {
            throw new Error("Відсутнє поле телеметрії: " + field);
        }
    }

    var features = {
        pose: { properties: {
            shoulderAngle: message.sh,
            elbowAngle: message.el,
            hipAngle: message.hip,
            kneeAngle: message.kn,
            headAngle: message.hd,
            torsoAngle: message.tor
        } },
        drive: { properties: { current: message.i, temperature: message.t } },
        power: { properties: { voltage: message.v } },
        safety: { properties: {
            limitSwitchActive: message.lim,
            emergencyStopActive: message.est
        } },
        sync: { properties: { seq: message.seq, ts: message.ts } }
    };

    return Ditto.buildDittoProtocolMsg(
        "org.pzks", match[1], "things", "twin", "commands", "merge", "/features",
        { "content-type": "application/merge-patch+json" }, features
    );
}
