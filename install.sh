echo install nodejs
#
sudo yum -y update
curl -sL https://rpm.nodesource.com/setup_12.x | sudo bash -
sudo yum clean all && sudo yum makecache fast
sudo yum install -y gcc-c++ make
sudo yum install -y nodejs
sudo yum install unzip
sudo apt install cron
#
echo firewall configuratin
#
yum install firewalld
systemctl start firewalld
sudo firewall-cmd --zone=public --add-port=443/tcp --permanent
sudo firewall-cmd --reload
firewall-cmd --list-all
#
echo install package
#
npm install -g nodemon
yum install git -y
yum install wget
npm install forever -g
#
echo install chrome
#
wget https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
sudo yum localinstall google-chrome-stable_current_x86_64.rpm
#
echo finalizing
#
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm i
#
echo finish
#
#
#
#
#6. run server
#npm run start
#forever start app.js
