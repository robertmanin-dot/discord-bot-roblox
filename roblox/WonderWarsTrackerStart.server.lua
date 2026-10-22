--[[
	WonderWarsTrackerStart (Script)
	Ablage: ServerScriptService > WonderWarsTrackerStart

	Startet das Tracking für den Discord-Bot. Mehr ist hier nicht nötig.
	Voraussetzung: Game Settings → Security → "Allow HTTP Requests" ist eingeschaltet.
]]

local Tracker = require(game:GetService("ServerScriptService"):WaitForChild("WonderWarsTracker"))
Tracker.Start()

--[[
	Beispiel, wie du in deinen eigenen Skripten Werte meldest:

	local Tracker = require(game.ServerScriptService.WonderWarsTracker)

	-- Wenn ein Spieler einen anderen besiegt:
	Tracker.AddStat(killer, "kills", 1)

	-- Wenn ein Spieler eine Runde gewinnt:
	Tracker.AddStat(gewinner, "siege", 1)
]]
