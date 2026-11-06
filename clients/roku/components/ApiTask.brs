sub init()
    m.top.functionName = "execute"
end sub
sub execute()
    transfer = CreateObject("roUrlTransfer")
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.SetUrl(m.top.url)
    transfer.SetRequest(m.top.method)
    transfer.RetainBodyOnError(true)
    transfer.AddHeader("Content-Type", "application/json")
    if m.top.token <> "" then transfer.AddHeader("Authorization", "Bearer " + m.top.token)
    if m.top.method = "GET"
        text = transfer.GetToString()
    else
        text = transfer.PostFromString(FormatJson(m.top.body))
    end if
    data = ParseJson(text)
    if type(data) <> "roAssociativeArray" then data = {error: "Could not read server response"}
    if transfer.GetResponseCode() < 200 or transfer.GetResponseCode() >= 300
        if data.error = invalid then data.error = "Server request failed. Check the address or pair this TV again."
    end if
    m.top.response = data
end sub
