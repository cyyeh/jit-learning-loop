1. A can't be read, right? Isn't a JWT encrypted with the server's secret? Without the secret you'd only see gibberish. B is a random string to begin with, so there's definitely nothing to read.
2. 401. The signature was computed over the original content, so once the content changes the signature won't match.
3. A: make a `/logout` where the server voids that token, so when the thief sends it again it gets a 401. B: delete that row from the `sessions` table, also a 401. So on revocation the two should be about the same?

I asked the mobile colleague: the app doesn't need to read what's inside the token, and no other service needs to verify it. They said JWT only because their last project used it. So let the experiment decide between A and B. Once you've run it, just build whichever you think fits and tell me why.
