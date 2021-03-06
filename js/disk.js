function Disk(opts) {
    jstorrent.Item.apply(this, arguments)
    this.__name__ = arguments.callee.name
    this.diskio = new jstorrent.DiskIO({disk:this})
    this.client = opts.client || opts.parent.parent
    this.app = opts.app
    this.concurrentBroken = 0
    this.think_interval = null

    this.test_tick_timeout = 30000 // when to say disk is broken
    //this.test_tick_timeout = 2000 // when to say disk is broken
    this.test_tick = this.test_tick_timeout * 2
    this.client.on('activeTorrentsChange', _.bind(function(){

        _.delay(function() {
            var numActive = this.client.get('numActiveTorrents')

            if (numActive == 0 && false) {
                console.log('disk, stop ticking') // dont stop ticking... hrm.
                if (this.think_interval) { 
                    clearInterval(this.think_interval)
                    this.think_interval = null
                }
            } else {
                if (! this.think_interval) {
                    console.log('disk, start ticking')
                    this.think_interval = setInterval( this.checkBroken.bind(this), this.test_tick )
                }
            }

        }.bind(this))

    },this))

    if (opts.key && opts.key == 'HTML5:persistent') {
        function ondir(result) {
            this.entry = result
            this.trigger('ready')
        }

        function onreq(result) {
            result.root.getDirectory("Download",{create:true},_.bind(ondir,this),_.bind(ondir,this))
        }
        var req = window.webkitRequestFileSystem || window.requestFileSystem
        req(window.PERSISTENT, 0, _.bind(onreq,this), _.bind(onreq,this))
        this.key = opts.key
    } else if (opts.id) {
        // being restored, need to call restoreEntry
        this.key = opts.id

        if (! this.key) {
            this.error = true
        }
        this.restoreFromKey()
    } else {
        this.entry = opts.entry
        this.onentry()
        this.key = null
    }
}
jstorrent.Disk = Disk
Disk.prototype = {
    restoreFromKey: function() {
        console.log('restoring disk with id',this.key)
        chrome.fileSystem.restoreEntry(this.key, _.bind(function(entry) {
            console.log('restored',this.key)
            // remove this.
            if (!entry) {
                console.error('unable to restore entry - (was the folder removed?)', this._opts.id)
                app.notify("Unable to load disk: "+this.key+". Was it removed?")
                var parts = this._opts.id.split(':')
                parts.shift()
                var folderName = parts.join(':')
                var collection = this.getCollection()
                collection.opts.client.trigger('error','Unable to load Download Directory: '+ folderName)
                // now loop over torrents using this download directory and set their error state
                var torrents = collection.opts.client.torrents
                for (var i=0; i<torrents.items.length; i++) {
                    if (torrents.items[i].get('disk') == this._opts.id) {
                        torrents.items[i].stop()
                        torrents.items[i].invalidDisk = true
                        torrents.items[i].set('state','error')                        
                    }
                }
                this.trigger('error')
                //collection.remove(this)
                //collection.save() // dont remove it
            } else {
                console.log('successfully restored disk entry',this.key)
                this.entry = entry
                this.onentry()
            }
        },this))
    },
    onentry: function() {
        if (chrome.fileSystem.getDisplayPath) {
            chrome.fileSystem.getDisplayPath(this.entry, function(displaypath) {
                //console.log('got display path',displaypath)
                this.set('entrydisplaypath',displaypath)
                this.trigger('ready') // XXX only after ALL disks are ready
            }.bind(this))
        }
    },
    checkBroken: function(callback) {
        if (! this.entry) { if (callback) {callback(true)}; return }
        //console.log('checkBroken')
        var _this = this
        if (this.checkingBroken) { console.log('alreadycheckingbroken');return }
        this.checkingBroken = true

        this.checkBrokenTimeout = setTimeout( function(){
            this.checkingBroken = false
            this.concurrentBroken++
            console.error('disk seems definitely broken. needs restart?',this.concurrentBroken)
            if (this.concurrentBroken > 2) {
                console.error('disk broken concurrently...',this.concurrentBroken)
                app.notify("FATAL DISK ERROR. Please restart the app",2)
                if (! this.reportedBroken) {
                    this.reportedBroken = true
                    //app.analytics.sendEvent('DiskIO','JobBroken',JSON.stringify(this.diskio.items[0]._attributes))
                    app.analytics.sendEvent('DiskIO','DiskBroken')
                }
            }
            if (callback) { callback(true) }
        }.bind(this),this.test_tick_timeout)

        this.entry.getMetadata(function(info) { // XXX - this is broken
            this.checkingBroken = false
            this.concurrentBroken = 0
            clearTimeout(this.checkBrokenTimeout)
            //console.log('notbroken')
            //console.log('disk getMetadata',info)
        }.bind(this),
                               function(err) {
                                   this.checkingBroken = false
                                   clearTimeout(this.checkBrokenTimeout)
                                   console.log('disk getMetadata err',err)
                                   if (err.name == 'NotFoundError') {
                                       // this can happen when we suspend and external storage hasnt yet attached
                                   } else {
                                       debugger
                                   }
                               }.bind(this)
                              )
    },
    cancelTorrentJobs: function(torrent) {
        this.diskio.cancelTorrentJobs(torrent)
    },
    get_key: function() {
        if (! this.key) { 
            this.key = chrome.fileSystem.retainEntry(this.entry)
        }
        return this.key
    },
    ensureFilesMetadata: function(files,callback) {
        // ensures a list of files have metadata in cache
        var need = []
        var state = {responses:0}
        var onresponse = function(result) {
            state.responses++
            if (state.responses == need.length) {
                callback()
            }
        }

        for (var i=0; i<files.length; i++) {
            var file = files[i]
            if (! file.getCachedMetadata()) {
                need.push(file)
                this.diskio.getMetadata({file:file},
                                        onresponse)
            }
        }
        if (need.length == 0) {
            callback()
        }
    }
}

for (var method in jstorrent.Item.prototype) {
    jstorrent.Disk.prototype[method] = jstorrent.Item.prototype[method]
}
