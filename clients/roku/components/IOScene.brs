sub init()
    m.top.backgroundColor = "0x111018FF"
    m.status = m.top.findNode("status")
    m.list = m.top.findNode("list")
    m.video = m.top.findNode("video")
    m.poll = m.top.findNode("poll")
    m.progress = m.top.findNode("progress")
    m.list.observeField("itemSelected", "selected")
    m.poll.observeField("fire", "pollPair")
    m.progress.observeField("fire", "saveProgress")
    m.video.observeField("state", "videoState")
    m.registry = CreateObject("roRegistrySection", "IOTV")
    m.server = m.registry.Read("server")
    m.token = m.registry.Read("token")
    m.rows = []
    m.offset = 0
    if m.server = "" then setup() else if m.token = "" then pair() else catalog(0)
end sub
sub showRows(rows)
    m.rows = rows
    node = CreateObject("roSGNode", "ContentNode")
    for each row in rows
        child = node.createChild("ContentNode")
        child.title = row.title
    end for
    m.list.content = node
    m.list.visible = true
    m.list.setFocus(true)
end sub
sub setup()
    dialog = CreateObject("roSGNode", "KeyboardDialog")
    dialog.title = "I/O server address (HTTPS, or local HTTP)"
    dialog.text = m.server
    dialog.buttons = ["Connect", "Cancel"]
    dialog.observeField("buttonSelected", "serverEntered")
    m.top.dialog = dialog
end sub
sub serverEntered(event)
    dialog = event.getRoSGNode()
    if event.getData() = 0
        address = dialog.text.Trim()
        valid = CreateObject("roRegex", "^https://[^/@?#]+/?$|^http://(localhost|127\.0\.0\.1|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+)(:[0-9]+)?/?$", "i")
        if not valid.IsMatch(address)
            m.status.text = "Enter an HTTPS address or a private local server address, without a path."
            return
        end if
        if Right(address, 1) = "/" then address = Left(address, Len(address) - 1)
        m.server = address
        m.token = ""
        m.registry.Write("server", m.server)
        m.registry.Delete("token")
        m.registry.Flush()
        dialog.close = true
        pair()
    else
        dialog.close = true
    end if
end sub
sub api(path, method, body, action)
    task = CreateObject("roSGNode", "ApiTask")
    task.url = m.server + path
    task.method = method
    task.body = body
    task.token = m.token
    task.addFields({action: action})
    task.observeField("response", "response")
    m.top.appendChild(task)
    task.control = "RUN"
end sub
sub pair()
    m.status.text = "Requesting a pairing code…"
    showRows([{title: "Change server", action: "server"}, {title: "Get a new code", action: "pair"}])
    api("/api/tv-native/pair/start", "POST", {name: "Roku TV"}, "pair")
end sub
sub pollPair()
    api("/api/tv-native/pair/poll", "POST", {code: m.code, pollSecret: m.secret}, "poll")
end sub
sub catalog(offset)
    m.mode = "catalog"
    m.offset = offset
    api("/api/tv-native/catalog?offset=" + offset.ToStr(), "GET", {}, "catalog")
end sub
sub response(event)
    task = event.getRoSGNode()
    data = event.getData()
    action = task.action
    m.top.removeChild(task)
    if data.error <> invalid
        m.status.text = data.error
        return
    end if
    if action = "pair"
        m.code = data.code
        m.secret = data.pollSecret
        m.status.text = "On your signed-in phone or computer, open:" + Chr(10) + m.server + "/#/tv-pair/" + m.code + Chr(10) + "Code: " + m.code + " — expires in five minutes"
        m.poll.control = "START"
    else if action = "poll"
        if data.status = "approved"
            m.token = data.token
            m.registry.Write("token", m.token)
            m.registry.Flush()
            catalog(0)
        else if data.status = "pending"
            m.poll.control = "START"
        else
            m.status.text = "Pairing expired. Get a new code."
        end if
    else if action = "catalog"
        m.status.text = "Profile: " + data.profileName
        rows = []
        for each item in data.items
            rows.Push({title: item.title, id: item.id, action: "title"})
        end for
        if data.nextOffset <> invalid then rows.Push({title: "Next page", action: "next", offset: data.nextOffset})
        if m.offset > 0 then rows.Push({title: "Previous page", action: "next", offset: m.offset - 50})
        rows.Push({title: "Change server / reconnect", action: "server"})
        showRows(rows)
    else if action = "title"
        m.mode = "episodes"
        m.titleId = data.id
        m.status.text = data.title
        rows = [{title: "Back to library", action: "catalog"}]
        for each episode in data.episodes
            resume = 0
            if data.progress <> invalid
                if data.progress.episode = episode.path then resume = data.progress.seconds
            end if
            rows.Push({title: episode.group + " · " + episode.title, path: episode.path, action: "play", offset: resume})
        end for
        showRows(rows)
    else if action = "play"
        agent = CreateObject("roHttpAgent")
        agent.AddHeader("Authorization", "Bearer " + m.token)
        agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
        m.video.setHttpAgent(agent)
        node = CreateObject("roSGNode", "ContentNode")
        node.url = m.server + data.playlistUrl
        node.streamFormat = "hls"
        m.playOffset = data.startOffsetSeconds
        m.video.content = node
        m.video.visible = true
        m.video.setFocus(true)
        m.video.control = "play"
        m.progress.control = "START"
    end if
end sub
sub selected()
    row = m.rows[m.list.itemSelected]
    if row.action = "server"
        setup()
    else if row.action = "pair"
        pair()
    else if row.action = "catalog"
        catalog(0)
    else if row.action = "next"
        catalog(row.offset)
    else if row.action = "title"
        api("/api/tv-native/title/" + row.id, "GET", {}, "title")
    else if row.action = "play"
        m.episode = row.path
        api("/api/tv-native/play", "POST", {id: m.titleId, episode: row.path, offset: row.offset, quality: "720"}, "play")
    end if
end sub
sub saveProgress()
    if m.video.duration <= 0 then return
    api("/api/tv-native/progress", "PUT", {id: m.titleId, episode: m.episode, seconds: m.playOffset + m.video.position, duration: m.playOffset + m.video.duration}, "progress")
end sub
sub videoState()
    if m.video.state = "finished" or m.video.state = "error"
        saveProgress()
        m.progress.control = "STOP"
        m.video.visible = false
        m.list.setFocus(true)
        if m.video.state = "error" then m.status.text = "Playback failed. Check the server or choose another episode."
    end if
end sub
function onKeyEvent(key, press) as Boolean
    if press and key = "back"
        if m.video.visible
            saveProgress()
            m.progress.control = "STOP"
            m.video.control = "stop"
            m.video.visible = false
            m.list.setFocus(true)
            return true
        else if m.mode = "episodes"
            catalog(0)
            return true
        end if
    end if
    return false
end function
