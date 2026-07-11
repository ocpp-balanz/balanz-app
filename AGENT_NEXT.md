1. Adjust styling to match more closely balanz-ui, the normal web ui, see c:\workspace\balanz-ui. This includes using light mode instead of dark.

2. Please study the documentation available at https://balanz.readthedocs.io/

3. Understand Group types. There are allocation groups (SmartCharging Group) and groups without SmartCharging. It is not allowed/safe to change charging speed for any charger/connector in a SmartCharging Group. This is the job of balanz backend!

3. Dial. Make it a real dial, with most important info as well. I am attaching a few screenshots

4. Charging graph. Make it a real graph. Make sure this graph can be reused, when we will later allow showing historic charging sessions.

5. Understand "free vending". Sometimes the User name shown as charging will be simply the charger id. This is because the charger is set to Free Vending (i.e. no need to scan RFID). App should show this.
