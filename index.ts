import express from "express";
import path from "path";
import * as http from 'http';
import * as socketIO from 'socket.io';


/*------------------------------------------------------------------------
Types
 ------------------------------------------------------------------------*/
enum Status {
    Online,
    Offline
}

class User {
    public id : number;
    public name : string;
    public status : Status;
    public textColour : string;
    public bgColour : string;

    constructor() {
        this.id = Math.floor(Math.random() * Math.floor(9999));
        this.name = "User" + this.id;
        this.status = Status.Online;
        this.textColour = "#000000";
        this.bgColour = "#bababa";
    }
}

enum MsgType {
    User,
    Info
}

class Message {
    public user : User;
    public type : MsgType;
    public content : string;
    public timestamp : string;
}

class Command {
    public user : User;
    public content : string;
}

const maxMessages = 200;

class ServerState {
    public users : User[];
    public messages : Message[];

    constructor() {
        this.users = [];
        this.messages = [];
    }
}

/*------------------------------------------------------------------------
Setup and state
 ------------------------------------------------------------------------*/
let app = express();
let server = http.createServer(app);
let io = require("socket.io")(server);

app.get('/', (req, res) => {
    res.sendFile(path.resolve("./chat_page.html"));
});

const state = new ServerState();

/*------------------------------------------------------------------------
Socket logic
 ------------------------------------------------------------------------*/
io.on("connection", (socket:socketIO.Socket) => {

    let onMsg = (msg: Message, sendToAll: boolean) =>{
        let time = new Date(Date.now()).toString().split(' GMT')[0];
        msg.timestamp = time;

        state.messages.push(msg);
        if (state.messages.length > maxMessages) {
            state.messages.shift();
        }

        if(sendToAll){
            io.emit('chat-msg', msg);
        }
        else{
            socket.emit('msg-timestamp', time);
            socket.broadcast.emit('chat-msg', msg);
        }
    }

    // Connections
    {
        socket.on('join', (user: User) => {

            let makeNew = true;
            if (user !== null && user !== undefined) {
                let idx = state.users.findIndex(tmp => tmp.id === user.id);
                if (idx !== -1) {
                    state.users[idx].status = Status.Online;
                    makeNew = false;
                }
            }
            if(makeNew) {
                user = new User();
                socket.emit('new-user', user);
                state.users.push(user);
            }

            const toSend : ServerState = {
                messages: state.messages,
                users: state.users.filter(user => user.status === Status.Online)
            };

            socket.emit('chat-state', toSend);
            socket.broadcast.emit('join', user);

            let msg : Message = {
              user: user,
              content: user.name + " joined chat",
              type: MsgType.Info,
              timestamp: null
            };
            onMsg(msg, true);
        });

        socket.on('leave', (user: User) => {
            let idx = state.users.findIndex(tmp => tmp.id === user.id);
            if (idx !== -1) {
                state.users[idx].status = Status.Offline;
            } else {
                return;
            }
            socket.broadcast.emit('leave', user);

            let msg : Message = {
                user: user,
                content: user.name + " left chat",
                type: MsgType.Info,
                timestamp: null
            };
            onMsg(msg, true);
        });
    }

    // Messaging
    socket.on('chat-msg', (msg) => {
        onMsg(msg, false);
    });

    // Commands
    const commands = '"/list" "/name <new name>" "/colour #RRGGBB" "text-colour #RRGGBB"';

    const server : User = {
        id: 0,
        name: "server",
        status: Status.Online,
        textColour: "#FFFFFF",
        bgColour: "#030303"
    };


    socket.on('command', (cmd : Command) => {
        let cmd_items = cmd.content.split(' ');
        let cmd_val = cmd_items.shift();

        let idx = state.users.findIndex(tmp => tmp.id === cmd.user.id);
        if(idx === -1) {
            console.log("Warning, unknown user sent command " + cmd.user.name + " " + cmd.user.id)
            return;
        }
        let user = state.users[idx];

        let msg: Message = {
            user: server,
            type: MsgType.Info,
            content: "",
            timestamp: null
        };

        const isValidColour = (value: string) => {
            let re = "\#[0-9a-fA-F]{6}";
            let result = value.match(re);

            return !(result === null
                || result.length > 1
                || !value.startsWith(result[0])
                || value.length !== result[0].length);
        }

        switch (cmd_val){
            case "/list": {
                msg.content = commands;
                onMsg(msg, true);
                break;
            }
            case "/name": {
                if(cmd_items.length <= 0){
                    let error = "Need to provide a name for the /name command";
                    socket.emit('cmd-error', error);
                    break;
                }

                let oldName = user.name;
                let newName = cmd_items.reduce((a, b) => a + " " + b, "");

                let idx = state.users.findIndex(tmp => tmp.name === newName && tmp.id !== cmd.user.id);
                if(idx !== -1){
                    let error = "Someone already claimed " + newName + " as a name. Pick another";
                    io.emit('cmd-error', error);
                    break;
                }

                user.name = newName;
                msg.content = oldName + " changed their name to " + user.name;

                onMsg(msg, true);
                io.emit('name-change', user);
                break;
            }
            case "/colour": {
                if(cmd_items.length !== 1){
                    let error = "Too many arguments for /colour command. You sent " + cmd_items.length;
                    socket.emit('cmd-error', error);
                    break;
                }
                if(isValidColour(cmd_items[0])){
                    user.bgColour = cmd_items[0];
                    io.emit('colour-change', user);

                    msg.content = user.name + " changed their message colour";
                    onMsg(msg, true);
                } else {
                    let error = "/colour in the form of #RRGGBB. You sent " + cmd_items[0];
                    socket.emit('cmd-error', error);
                }
                break;
            }
            case "/text-colour": {
                if(cmd_items.length !== 1){
                    let error = "Too many args for /text-colour command. You sent " + cmd_items.length;
                    socket.emit('cmd-error', error);
                    break;
                }
                if(isValidColour(cmd_items[0])){
                    user.textColour = cmd_items[0];
                    io.emit('text-colour-change', user);

                    msg.content = user.name + " changed their font colour";
                    onMsg(msg, true);
                } else {
                    let error = "/text-colour in the form of #RRGGBB. You sent " + cmd_items[0];
                    socket.emit('cmd-error', error);
                }
               break;
            }
            default: {
                let error = "Unknown command " + cmd_val;
                socket.emit('cmd-error', error);
                break;
            }
        }
    });
});

server.listen(3000, () => {
    console.log("Listening on *:3000");
})