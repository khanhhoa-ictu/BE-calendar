scoop install main/ngrok
ngrok config add-authtoken 2gxc2UgTf7SCkm1vMnj2vwu9qCj_6W5z5MxE3qZvuLiYfkLrb
ngrok http 8080 --region=us
git checkout main  
git pull origin main
git checkout bang
git merge main
sudo NET start MySQL_Scoop; # start the Service
yarn
npm run start