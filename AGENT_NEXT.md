1. When doing a auto-refresh, it seems that the App calls GetGroups and then GetChargers for the specific Charger. That seems unnecessary and putting unnecessary load on the server. I would suggest to only do the GetChargers call for a refresh.

2. The charging graph is very difficult to view. For instance, the x-axis text with the time of day is too small.

3. The buttom to show the graph for the current session does not needs it's own frame, but can be put in the main frame.

4. If a command has been issued (change of max charging speed or priority), then do the next automatic refresh after 10 seconds.

5. Date/time format should be YYYY-MM-DD hh:mm

