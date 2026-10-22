--!strict
--[[
	WonderWarsTracker (ModuleScript)
	Ablage: ServerScriptService > WonderWarsTracker

	Schickt jede Minute an den Discord-Bot:
	  • wer gerade spielt und wie lange (für Playtest-Teilnahme und Spielzeit-Rangliste)
	  • Werte wie Kills oder Siege, die du im Spiel mit Tracker.AddStat(...) meldest

	Benutzung in deinen eigenen Server-Skripten:
	  local Tracker = require(game.ServerScriptService.WonderWarsTracker)
	  Tracker.AddStat(player, "kills", 1)
	  Tracker.AddStat(player, "siege", 1)

	Erlaubte Namen für Werte: Kleinbuchstaben, Zahlen und _ (z. B. "kills", "siege", "runden_gespielt").
	Der Name "spielzeit" ist reserviert, die Spielzeit wird automatisch gezählt.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local CONFIG = {
	-- Adresse deines Bots (muss von außen per HTTPS erreichbar sein)
	API_URL = "https://DEIN-BOT.example.com/api/v1/report",

	-- Name des Secrets in den Spieleinstellungen (Creator Dashboard → Secrets).
	-- Der Wert muss genau dem GAME_API_KEY aus der .env des Bots entsprechen.
	SECRET_NAME = "WW_BOT_API_KEY",

	-- Nur zum Testen in Roblox Studio. NIEMALS mit eingetragenem Schlüssel veröffentlichen!
	STUDIO_API_KEY = "",

	-- Sekunden zwischen zwei Sendungen
	SEND_INTERVAL = 60,

	-- Wie viele fehlgeschlagene Pakete für einen späteren Versuch aufgehoben werden
	MAX_RETRY_BATCHES = 20,
}

local STAT_NAME_PATTERN = "^[a-z0-9_]+$"

type PlayerReport = { userId: number, name: string, seconds: number }
type StatReport = { userId: number, stat: string, delta: number }
type Batch = { batchId: string, recordedAt: number, players: { PlayerReport }, stats: { StatReport } }

local Tracker = {}

local lastCounted: { [number]: number } = {} -- userId → os.clock() der letzten Zählung
local names: { [number]: string } = {}
local leftoverSeconds: { [number]: number } = {} -- Spielzeit von Spielern, die das Spiel verlassen haben
local statTotals: { [number]: { [string]: number } } = {}
local retryQueue: { Batch } = {}
local started = false
local apiKey: any = nil

local function loadApiKey(): any
	local ok, secret = pcall(function()
		return HttpService:GetSecret(CONFIG.SECRET_NAME)
	end)
	if ok and secret then
		return secret
	end
	if RunService:IsStudio() and CONFIG.STUDIO_API_KEY ~= "" then
		return CONFIG.STUDIO_API_KEY
	end
	warn("[WonderWarsTracker] Kein API-Schlüssel gefunden. Lege das Secret '" .. CONFIG.SECRET_NAME .. "' an.")
	return nil
end

--- Meldet einen Wert für einen Spieler, z. B. Tracker.AddStat(player, "kills", 1)
function Tracker.AddStat(player: Player, stat: string, amount: number?)
	local delta = amount or 1
	if typeof(player) ~= "Instance" or not player:IsA("Player") then
		warn("[WonderWarsTracker] AddStat: erstes Argument muss ein Player sein")
		return
	end
	if type(stat) ~= "string" or #stat > 32 or not string.match(stat, STAT_NAME_PATTERN) or stat == "spielzeit" then
		warn("[WonderWarsTracker] AddStat: ungültiger Name '" .. tostring(stat) .. "' (nur a-z, 0-9, _)")
		return
	end
	if type(delta) ~= "number" or delta ~= delta or math.abs(delta) == math.huge then
		warn("[WonderWarsTracker] AddStat: Menge muss eine Zahl sein")
		return
	end
	local totals = statTotals[player.UserId]
	if not totals then
		totals = {}
		statTotals[player.UserId] = totals
	end
	totals[stat] = (totals[stat] or 0) + delta
end

local function startCounting(player: Player)
	lastCounted[player.UserId] = os.clock()
	names[player.UserId] = player.Name
end

local function stopCounting(player: Player)
	local since = lastCounted[player.UserId]
	if since then
		leftoverSeconds[player.UserId] = (leftoverSeconds[player.UserId] or 0) + (os.clock() - since)
		lastCounted[player.UserId] = nil
	end
end

local function buildBatch(): Batch?
	local now = os.clock()
	local seconds: { [number]: number } = {}

	for userId, since in pairs(lastCounted) do
		seconds[userId] = (seconds[userId] or 0) + (now - since)
		lastCounted[userId] = now
	end
	for userId, extra in pairs(leftoverSeconds) do
		seconds[userId] = (seconds[userId] or 0) + extra
	end
	table.clear(leftoverSeconds)

	local players: { PlayerReport } = {}
	for userId, s in pairs(seconds) do
		local rounded = math.floor(s + 0.5)
		if rounded > 0 then
			table.insert(players, { userId = userId, name = names[userId] or "", seconds = rounded })
		end
	end

	local stats: { StatReport } = {}
	for userId, totals in pairs(statTotals) do
		for stat, delta in pairs(totals) do
			if delta ~= 0 then
				table.insert(stats, { userId = userId, stat = stat, delta = delta })
			end
		end
	end
	table.clear(statTotals)

	-- Namen von Spielern, die nicht mehr da sind, vergessen
	for userId in pairs(names) do
		if not lastCounted[userId] then
			names[userId] = nil
		end
	end

	if #players == 0 and #stats == 0 then
		return nil
	end
	return { batchId = HttpService:GenerateGUID(false), recordedAt = os.time(), players = players, stats = stats }
end

--- Sendet ein Paket. Gibt "ok", "retry" (später nochmal) oder "drop" (Daten falsch, verwerfen) zurück.
local function send(batch: Batch): string
	if not apiKey then
		apiKey = loadApiKey()
		if not apiKey then
			return "retry"
		end
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = CONFIG.API_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-Api-Key"] = apiKey,
			},
			Body = HttpService:JSONEncode(batch),
		})
	end)
	if not ok then
		warn("[WonderWarsTracker] Senden fehlgeschlagen: " .. tostring(response))
		return "retry"
	end
	if response.Success then
		return "ok"
	end
	if response.StatusCode >= 400 and response.StatusCode < 500 then
		warn("[WonderWarsTracker] Bot lehnt Daten ab (" .. response.StatusCode .. "): " .. tostring(response.Body))
		return "drop"
	end
	return "retry"
end

--- Sendet alles, was sich angesammelt hat. Wird automatisch jede Minute aufgerufen.
function Tracker.Flush()
	local batch = buildBatch()
	if batch then
		table.insert(retryQueue, batch)
	end
	while #retryQueue > CONFIG.MAX_RETRY_BATCHES do
		table.remove(retryQueue, 1)
	end

	-- Ältestes zuerst. Bei einem Netzwerkfehler aufhören und beim nächsten Mal weitermachen.
	while #retryQueue > 0 do
		local result = send(retryQueue[1])
		if result == "retry" then
			break
		end
		table.remove(retryQueue, 1)
	end
end

--- Startet das Tracking. Wird vom Skript "WonderWarsTrackerStart" aufgerufen.
function Tracker.Start()
	if started then
		return
	end
	started = true

	for _, player in ipairs(Players:GetPlayers()) do
		startCounting(player)
	end
	Players.PlayerAdded:Connect(startCounting)
	Players.PlayerRemoving:Connect(stopCounting)

	task.spawn(function()
		while true do
			task.wait(CONFIG.SEND_INTERVAL)
			Tracker.Flush()
		end
	end)

	-- Beim Herunterfahren des Servers den Rest noch schicken
	game:BindToClose(function()
		for _, player in ipairs(Players:GetPlayers()) do
			stopCounting(player)
		end
		Tracker.Flush()
	end)
end

return Tracker
